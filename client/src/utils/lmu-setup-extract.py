#!python3
"""
LMU Setup Extractor
==================

Le Mans Ultimate does not expose the full garage setup via shared memory (only a few basic values).
This daemon extracts the *full* setup by watching setup files on disk and emitting updates as JSON
lines to stdout, similar to `setup-extract.py` for iRacing.

How it works:
- Detects a setup directory (env override or best-effort auto-discovery)
- Finds the most recently modified setup file (e.g. .svm/.ini/.json/.txt)
- Parses it into a structured dict (INI-like sections supported)
- Emits JSON when the file content changes (hash-based)

Environment variables:
- LMU_SETUP_DIR: Absolute directory to watch for setup files (recommended).
"""

import os
import sys
import json
import time
import hashlib
import re
from typing import Any, Dict, Optional, Tuple, List


POLL_INTERVAL_S = 1.0
LOG_EVERY_S = 10.0

SUPPORTED_EXTS = {".svm", ".ini", ".json", ".txt"}


class State:
    last_setup_hash: Optional[str] = None
    last_emit_time: float = 0.0
    last_connection_log: float = 0.0
    last_watch_dir_log: float = 0.0
    update_count: int = 0
    last_file_path: Optional[str] = None


def _now_ms() -> int:
    return int(time.time() * 1000)


def _log(message: str) -> None:
    print(json.dumps({"type": "LOG", "message": message}), file=sys.stderr, flush=True)


def _read_text_file(path: str) -> str:
    # LMU/rF2 style files are usually plain text; be forgiving with encoding.
    with open(path, "r", encoding="utf-8-sig", errors="replace") as f:
        return f.read()


def _parse_scalar(value: str) -> Any:
    v = value.strip()
    if v == "":
        return ""
    lower = v.lower()
    if lower in {"true", "false"}:
        return lower == "true"
    # ints
    try:
        if lower.startswith("0x"):
            return int(lower, 16)
        if "." not in v and "e" not in lower:
            return int(v)
    except Exception:
        pass
    # floats
    try:
        return float(v)
    except Exception:
        return v


def parse_ini_like(text: str) -> Dict[str, Any]:
    """
    Parse an INI-like file with [SECTIONS] and key=value lines.
    This matches the typical rFactor2/LMU .svm setup format.
    """
    out: Dict[str, Any] = {}
    section = "ROOT"
    out[section] = {}

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        # comments
        if line.startswith(";") or line.startswith("#") or line.startswith("//"):
            continue

        if line.startswith("[") and line.endswith("]") and len(line) > 2:
            section = line[1:-1].strip() or "ROOT"
            if section not in out:
                out[section] = {}
            continue

        if "=" in line:
            key, val = line.split("=", 1)
            key = key.strip()
            val = val.strip()
            if key:
                out.setdefault(section, {})
                out[section][key] = _parse_scalar(val)

    # Flatten ROOT if it's empty
    if isinstance(out.get("ROOT"), dict) and len(out["ROOT"]) == 0:
        out.pop("ROOT", None)
    return out


def parse_setup_file(path: str) -> Tuple[Dict[str, Any], str]:
    """
    Returns: (parsed_setup, format)
    """
    ext = os.path.splitext(path)[1].lower()
    text = _read_text_file(path)

    # Best-effort JSON detection (some tools export json even without .json extension)
    if ext == ".json" or (text.lstrip().startswith("{") and text.rstrip().endswith("}")):
        try:
            return json.loads(text), "json"
        except Exception:
            # fall through to ini-like
            pass

    parsed = parse_ini_like(text)
    return parsed, "ini"


def get_hash_for_file(path: str) -> str:
    # Hash file contents (not only mtime) to detect actual setup changes
    data = _read_text_file(path).encode("utf-8", errors="replace")
    return hashlib.md5(data).hexdigest()


def list_candidate_dirs() -> List[str]:
    env_dir = os.environ.get("LMU_SETUP_DIR")
    if env_dir:
        return [env_dir]

    # Best-effort heuristics (may vary per install). Keep it conservative.
    user = os.environ.get("USERPROFILE") or ""
    local_appdata = os.environ.get("LOCALAPPDATA") or ""
    docs = os.path.join(user, "Documents") if user else ""

    candidates: List[str] = []
    if docs:
        candidates.extend(
            [
                os.path.join(docs, "Le Mans Ultimate", "UserData", "player", "Settings"),
                os.path.join(docs, "Le Mans Ultimate", "UserData", "player", "Setups"),
                os.path.join(docs, "LeMansUltimate", "UserData", "player", "Settings"),
            ]
        )
    if local_appdata:
        candidates.extend(
            [
                os.path.join(local_appdata, "Le Mans Ultimate", "UserData", "player", "Settings"),
                os.path.join(local_appdata, "LeMansUltimate", "UserData", "player", "Settings"),
            ]
        )

    # Steam install locations (some installs keep UserData under the game folder)
    steam_roots: List[str] = []
    program_files_x86 = os.environ.get("ProgramFiles(x86)") or ""
    program_files = os.environ.get("ProgramFiles") or ""
    steam_roots.extend(
        [
            os.path.join(program_files_x86, "Steam") if program_files_x86 else "",
            os.path.join(program_files, "Steam") if program_files else "",
            os.environ.get("STEAM_DIR") or "",
        ]
    )
    steam_roots = [p for p in steam_roots if p and os.path.isdir(p)]

    # Parse additional Steam library folders from libraryfolders.vdf (if present)
    for steam_root in list(dict.fromkeys(steam_roots)):
        vdf = os.path.join(steam_root, "steamapps", "libraryfolders.vdf")
        if not os.path.isfile(vdf):
            continue
        try:
            text = _read_text_file(vdf)
            for m in re.finditer(r'"path"\s*"([^"]+)"', text):
                raw = m.group(1)
                # VDF uses escaped backslashes on Windows
                path_val = raw.replace("\\\\", "\\")
                if os.path.isdir(path_val):
                    steam_roots.append(path_val)
        except Exception:
            pass

    # Build candidate LMU setup dirs under each library
    for root in list(dict.fromkeys(steam_roots)):
        common = os.path.join(root, "steamapps", "common")
        lmu_player = os.path.join(common, "Le Mans Ultimate", "UserData", "player")
        if os.path.isdir(lmu_player):
            # Watch whole player dir so we also catch TempModFile.svm and other exports
            candidates.extend([lmu_player, os.path.join(lmu_player, "Settings")])

    return candidates


def find_latest_setup_file(root_dir: str) -> Optional[str]:
    if not os.path.isdir(root_dir):
        return None

    latest_path: Optional[str] = None
    latest_mtime: float = 0.0

    for dirpath, _dirnames, filenames in os.walk(root_dir):
        for name in filenames:
            ext = os.path.splitext(name)[1].lower()
            if ext not in SUPPORTED_EXTS:
                continue
            path = os.path.join(dirpath, name)
            try:
                st = os.stat(path)
            except OSError:
                continue
            if st.st_mtime > latest_mtime:
                latest_mtime = st.st_mtime
                latest_path = path

    return latest_path


def emit_setup(file_path: str, parsed: Dict[str, Any], fmt: str) -> None:
    State.update_count += 1
    payload = {
        "type": "LMU_SETUP",
        "timestamp": _now_ms(),
        "updateCount": State.update_count,
        "carSetup": parsed,
        "source": {
            "file": file_path,
            "format": fmt,
        },
        "pit": None,
    }
    print(json.dumps(payload, ensure_ascii=False), flush=True)
    State.last_emit_time = time.time()
    State.last_file_path = file_path


def run_daemon() -> None:
    while True:
        candidates = list_candidate_dirs()
        watch_dir = next((d for d in candidates if os.path.isdir(d)), None)

        if not watch_dir:
            now = time.time()
            if now - State.last_connection_log > LOG_EVERY_S:
                env_dir = os.environ.get("LMU_SETUP_DIR")
                hint = f" (LMU_SETUP_DIR={env_dir})" if env_dir else ""
                _log(
                    "Waiting for LMU setup directory... "
                    "Set LMU_SETUP_DIR to your setup folder." + hint
                )
                State.last_connection_log = now
            time.sleep(2.0)
            continue

        # Log chosen watch dir occasionally (helps diagnose auto-discovery)
        now = time.time()
        if now - State.last_watch_dir_log > LOG_EVERY_S:
            _log(f"Watching setup dir: {watch_dir}")
            State.last_watch_dir_log = now

        latest_file = find_latest_setup_file(watch_dir)
        if not latest_file:
            now = time.time()
            if now - State.last_connection_log > LOG_EVERY_S:
                _log(f"No setup files found under: {watch_dir} (extensions: {sorted(SUPPORTED_EXTS)})")
                State.last_connection_log = now
            time.sleep(2.0)
            continue

        try:
            current_hash = get_hash_for_file(latest_file)
        except Exception as e:
            _log(f"Failed to hash setup file: {latest_file} ({e})")
            time.sleep(POLL_INTERVAL_S)
            continue

        if current_hash != State.last_setup_hash:
            try:
                parsed, fmt = parse_setup_file(latest_file)
                emit_setup(latest_file, parsed, fmt)
                State.last_setup_hash = current_hash
                _log(f"Setup changed: {os.path.basename(latest_file)}")
            except Exception as e:
                _log(f"Failed to parse setup file: {latest_file} ({e})")

        time.sleep(POLL_INTERVAL_S)


if __name__ == "__main__":
    try:
        run_daemon()
    except KeyboardInterrupt:
        _log("Stopped by user")
