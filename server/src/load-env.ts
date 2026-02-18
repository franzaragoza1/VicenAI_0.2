import * as fs from 'fs';
import * as path from 'path';

let loaded = false;

function parseLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const eq = trimmed.indexOf('=');
  if (eq <= 0) return null;
  const key = trimmed.slice(0, eq).trim();
  let value = trimmed.slice(eq + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  if (!key) return null;
  return { key, value };
}

export function loadEnvOnce(options?: { cwd?: string; files?: string[]; overrideProcessEnv?: boolean }) {
  if (loaded) return;
  loaded = true;

  const cwd = options?.cwd ?? process.cwd();
  const overrideProcessEnv = options?.overrideProcessEnv ?? false;
  const requestedFiles = options?.files ?? ['.env.local', '.env'];
  // With override enabled, later files win. Load .env first so .env.local has final priority.
  const files = overrideProcessEnv && !options?.files ? [...requestedFiles].reverse() : requestedFiles;

  for (const file of files) {
    const filePath = path.resolve(cwd, file);
    if (!fs.existsSync(filePath)) continue;
    let raw = '';
    try {
      raw = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const parsed = parseLine(line);
      if (!parsed) continue;
      if (overrideProcessEnv || process.env[parsed.key] === undefined) {
        process.env[parsed.key] = parsed.value;
      }
    }
  }
}
