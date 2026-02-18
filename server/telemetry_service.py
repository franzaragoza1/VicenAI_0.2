#!/usr/bin/env python3
"""
iRacing Telemetry Service - MINIMAL DATA PIPELINE
=================================================
Reads strategic data from iRacing and sends to Node.js via WebSocket.

Philosophy:
- This is a "dumb messenger" - read and forward, no analysis
- Gemini is the "brain" - it analyzes and decides strategy
- Only basic arithmetic allowed (deltas, averages)

DO NOT add: "fuel critical", "gap closing", "under pressure" logic
"""

import sys
import os
import json
import time
import asyncio
import logging
import uuid
from collections import deque
from typing import Optional, Dict, Any, List
from dataclasses import dataclass, asdict, field

# Add pyirsdk to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'pyirsdk_Reference'))

try:
    import irsdk  # type: ignore[import-not-found]  # pyirsdk loaded via sys.path.insert
except ImportError:
    print("[ERROR] pyirsdk not found. Install it or check PYTHONPATH")
    sys.exit(1)

try:
    import websockets
except ImportError:
    print("[ERROR] websockets not found. Install with: pip install websockets")
    sys.exit(1)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] [%(levelname)s] %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger('TelemetryService')

# ============================================================================
# CONSTANTS
# ============================================================================

WEBSOCKET_PORT = 8766
SNAPSHOT_INTERVAL = 5.0  # Seconds between full snapshots
POLL_INTERVAL = 1.0      # Read iRacing at 1Hz (strategic data)
RECONNECT_DELAY = 5.0    # Seconds to wait before reconnecting to iRacing
FUEL_HISTORY_SIZE = 10   # Ring buffer size for fuel calculations

# === LAP TELEMETRY CAPTURE ===
LAP_CAPTURE_INTERVAL = 0.05  # 20Hz for detailed lap telemetry
MAX_STORED_LAPS = 10         # Maximum laps to keep in memory per track/car
LAP_POINTS_BUFFER_SIZE = 3000  # ~2.5 minutes at 20Hz, enough for any lap
MIN_LAP_POINTS = 100         # Minimum points required for a valid lap

# Flag names for human-readable output
FLAG_NAMES = {
    0x0001: "checkered",
    0x0002: "white",
    0x0004: "green",
    0x0008: "yellow",
    0x0010: "red",
    0x0020: "blue",
    0x0040: "debris",
    0x0080: "crossed",
    0x0100: "yellow_waving",
    0x0200: "one_lap_to_green",
    0x0400: "green_held",
    0x0800: "ten_to_go",
    0x1000: "five_to_go",
    0x4000: "caution",
    0x8000: "caution_waving",
    0x010000: "black",
    0x020000: "disqualify",
    0x080000: "furled",
    0x100000: "repair",
}

SESSION_STATE_NAMES = {
    0: "invalid",
    1: "get_in_car",
    2: "warmup",
    3: "parade_laps",
    4: "racing",
    5: "checkered",
    6: "cool_down",
}

# Track wetness names for human-readable output
TRACK_WETNESS_NAMES = {
    0: "unknown",
    1: "dry",
    2: "mostly_dry",
    3: "very_lightly_wet",
    4: "lightly_wet",
    5: "moderately_wet",
    6: "very_wet",
    7: "extremely_wet",
}

# Pit service flags for reading current pit configuration
PIT_SV_FLAGS = {
    'lf_tire_change': 0x01,
    'rf_tire_change': 0x02,
    'lr_tire_change': 0x04,
    'rr_tire_change': 0x08,
    'fuel_fill': 0x10,
    'windshield_tearoff': 0x20,
    'fast_repair': 0x40,
}

# Pit command modes for sending pit commands
PIT_COMMAND_MODES = {
    'clear': 0,
    'ws': 1,
    'fuel': 2,
    'lf': 3,
    'rf': 4,
    'lr': 5,
    'rr': 6,
    'clear_tires': 7,
    'fr': 8,
    'clear_ws': 9,
    'clear_fr': 10,
    'clear_fuel': 11,
}

# Chat command modes
CHAT_COMMAND_MODES = {
    'macro': 0,
    'begin_chat': 1,
    'reply': 2,
    'cancel': 3,
}


# ============================================================================
# OPPONENT SECTOR TRACKING
# ============================================================================

class OpponentSectorTracker:
    """
    Tracks sector times for all opponents in the session.
    Monitors CarIdxLapDistPct to detect sector crossings and calculates sector times.
    """
    
    def __init__(self):
        # Store last known state for each car
        self.car_states: Dict[int, Dict[str, Any]] = {}  # car_idx -> {last_dist, last_sector, sector_times, last_session_time}
        self.max_cars = 64  # iRacing supports up to 64 cars
        logger.info("🏁 OpponentSectorTracker initialized")
    
    def reset(self):
        """Reset all tracking data (e.g., on session change)."""
        self.car_states.clear()
        logger.debug("🔄 OpponentSectorTracker reset")
    
    def update(self, ir: 'irsdk.IRSDK', session_time: float):
        """
        Update sector tracking for all cars.
        
        Args:
            ir: iRacing SDK instance
            session_time: Current SessionTime from iRacing
        """
        try:
            lap_dist_pcts = ir['CarIdxLapDistPct'] or []
            track_surfaces = ir['CarIdxTrackSurface'] or []
            
            for car_idx in range(min(len(lap_dist_pcts), self.max_cars)):
                dist_pct = lap_dist_pcts[car_idx]
                
                # Skip if car not on track or invalid data
                if dist_pct < 0 or car_idx >= len(track_surfaces):
                    continue
                
                track_surface = track_surfaces[car_idx]
                # -1 = not in world, 0 = off track
                if track_surface < 0:
                    continue
                
                # Initialize car state if first time seeing this car
                if car_idx not in self.car_states:
                    self.car_states[car_idx] = {
                        'last_dist': dist_pct,
                        'last_sector': self._get_sector_from_dist(dist_pct),
                        'sector_times': {'s1': None, 's2': None, 's3': None},
                        'sector_start_time': session_time,
                        'last_session_time': session_time,
                    }
                    continue
                
                state = self.car_states[car_idx]
                last_dist = state['last_dist']
                last_sector = state['last_sector']
                current_sector = self._get_sector_from_dist(dist_pct)
                
                # Detect sector crossing (forward progress)
                if current_sector != last_sector:
                    # Handle lap wrap (sector 3 -> sector 1)
                    if last_sector == 3 and current_sector == 1:
                        # Completed sector 3
                        sector_time = session_time - state['sector_start_time']
                        if 0 < sector_time < 300:  # Sanity check: 0-5 minutes
                            state['sector_times']['s3'] = round(sector_time, 3)
                        state['sector_start_time'] = session_time
                    
                    # Normal sector progression
                    elif current_sector == last_sector + 1:
                        # Completed previous sector
                        sector_key = f's{last_sector}'
                        sector_time = session_time - state['sector_start_time']
                        if 0 < sector_time < 300:  # Sanity check
                            state['sector_times'][sector_key] = round(sector_time, 3)
                        state['sector_start_time'] = session_time
                    
                    state['last_sector'] = current_sector
                
                # Update state
                state['last_dist'] = dist_pct
                state['last_session_time'] = session_time
                
        except Exception as e:
            logger.debug(f"Error updating opponent sectors: {e}")
    
    def _get_sector_from_dist(self, dist_pct: float) -> int:
        """Convert lap distance percentage to sector number (1, 2, or 3)."""
        if dist_pct < 0.33:
            return 1
        elif dist_pct < 0.66:
            return 2
        else:
            return 3
    
    def get_sectors(self, car_idx: int) -> Dict[str, Optional[float]]:
        """
        Get sector times for a specific car.
        
        Returns:
            Dict with 's1', 's2', 's3' keys (values are None if not yet recorded)
        """
        if car_idx not in self.car_states:
            return {'s1': None, 's2': None, 's3': None}
        return self.car_states[car_idx]['sector_times'].copy()


# ============================================================================
# LAP TELEMETRY DATA STRUCTURES
# ============================================================================

@dataclass
class TelemetryPoint:
    """Single point of telemetry data for lap analysis graphs."""
    distancePct: float      # 0.0 - 1.0
    speed: float            # km/h
    throttle: float         # 0.0 - 1.0
    brake: float            # 0.0 - 1.0
    gear: int               # -1 to 8
    rpm: float              # RPM
    steeringAngle: float    # radians

@dataclass 
class LapData:
    """Complete lap data with telemetry points for comparison."""
    id: str
    lapNumber: int
    lapTime: float                    # seconds
    isSessionBest: bool               # True if this is the best lap of the session
    trackName: str
    carName: str
    completedAt: int                  # timestamp ms
    points: List[Dict] = field(default_factory=list)  # List of TelemetryPoint as dicts
    deltaToSessionBest: float = 0.0   # seconds difference to session best


class LapStorageService:
    """
    Stores completed laps in memory for comparison analysis.
    Tracks session best and allows retrieval by various criteria.
    """
    
    def __init__(self, max_laps: int = MAX_STORED_LAPS):
        self.max_laps = max_laps
        self.laps: Dict[str, LapData] = {}  # id -> LapData
        self.session_best_id: Optional[str] = None
        self.session_best_time: float = float('inf')
        
        # Current lap being recorded
        self.current_lap_points: List[TelemetryPoint] = []
        self.current_lap_number: int = 0
        self.recording_active: bool = False
        self.last_capture_time: float = 0.0
        self.last_distance_pct: float = 0.0
        
        # Pending lap waiting for time (iRacing delay issue)
        self.pending_lap_points: List[TelemetryPoint] = []
        self.pending_lap_number: int = 0
        self.pending_lap_track: str = ''
        self.pending_lap_car: str = ''
        self.pending_lap_created_at: float = 0.0  # Timestamp when pending was created
        
        logger.info("📊 LapStorageService initialized")
    
    def start_lap(self, lap_number: int):
        """Start recording a new lap."""
        self.current_lap_points = []
        self.current_lap_number = lap_number
        self.recording_active = True
        self.last_distance_pct = 0.0
        logger.debug(f"🏁 Started recording lap {lap_number}")
    
    def add_point(self, point: TelemetryPoint):
        """Add a telemetry point to current lap."""
        if not self.recording_active:
            return
        
        # Only add if we're moving forward (avoid duplicate points)
        if point.distancePct >= self.last_distance_pct or point.distancePct < 0.05:
            self.current_lap_points.append(point)
            self.last_distance_pct = point.distancePct
    
    def complete_lap(self, lap_time: float, track_name: str, car_name: str) -> Optional[LapData]:
        """Complete current lap and store it."""
        if not self.recording_active or len(self.current_lap_points) < 100:
            # Need at least some points for a valid lap
            logger.debug(f"Lap discarded: recording={self.recording_active}, points={len(self.current_lap_points)}")
            self.recording_active = False
            return None
        
        # Validate lap time - must be between 10s and 20 minutes (reasonable for any track)
        if lap_time < 10.0 or lap_time > 1200.0:
            logger.warning(f"⚠️ Invalid lap time rejected: {lap_time:.3f}s (must be 10s-20min)")
            self.recording_active = False
            self.current_lap_points = []
            return None
        
        # Create lap data
        lap_id = str(uuid.uuid4())[:8]
        is_session_best = lap_time < self.session_best_time
        
        lap = LapData(
            id=lap_id,
            lapNumber=self.current_lap_number,
            lapTime=round(lap_time, 3),
            isSessionBest=is_session_best,
            trackName=track_name,
            carName=car_name,
            completedAt=int(time.time() * 1000),
            points=[asdict(p) for p in self.current_lap_points],
            deltaToSessionBest=round(lap_time - self.session_best_time, 3) if self.session_best_time < float('inf') else 0.0
        )
        
        # Update session best
        if is_session_best:
            # Mark previous best as not best anymore
            if self.session_best_id and self.session_best_id in self.laps:
                self.laps[self.session_best_id].isSessionBest = False
            
            self.session_best_id = lap_id
            self.session_best_time = lap_time
            logger.info(f"⭐ NEW SESSION BEST: {lap_time:.3f}s (Lap {self.current_lap_number})")
        
        # Store lap
        self.laps[lap_id] = lap
        
        # Enforce max laps limit (remove oldest, but keep session best)
        self._enforce_limit()
        
        # Reset recording state
        self.recording_active = False
        self.current_lap_points = []
        
        logger.info(f"✅ Lap {self.current_lap_number} stored: {lap_time:.3f}s ({len(lap.points)} points)")
        return lap
    
    def save_pending_lap(self, lap_time: float) -> Optional[LapData]:
        """Save a pending lap that was waiting for its lap time."""
        if not self.pending_lap_points or len(self.pending_lap_points) < 100:
            logger.debug(f"No valid pending lap to save: points={len(self.pending_lap_points)}")
            self.pending_lap_points = []
            return None
        
        # Validate lap time - must be between 10s and 20 minutes
        if lap_time < 10.0 or lap_time > 1200.0:
            logger.warning(f"⚠️ Invalid pending lap time rejected: {lap_time:.3f}s")
            self.pending_lap_points = []
            self.pending_lap_number = 0
            return None
        
        # Create lap data from pending
        lap_id = str(uuid.uuid4())[:8]
        is_session_best = lap_time < self.session_best_time
        
        lap = LapData(
            id=lap_id,
            lapNumber=self.pending_lap_number,
            lapTime=round(lap_time, 3),
            isSessionBest=is_session_best,
            trackName=self.pending_lap_track,
            carName=self.pending_lap_car,
            completedAt=int(time.time() * 1000),
            points=[asdict(p) if hasattr(p, '__dict__') else p for p in self.pending_lap_points],
            deltaToSessionBest=round(lap_time - self.session_best_time, 3) if self.session_best_time < float('inf') else 0.0
        )
        
        # Update session best
        if is_session_best:
            if self.session_best_id and self.session_best_id in self.laps:
                self.laps[self.session_best_id].isSessionBest = False
            
            self.session_best_id = lap_id
            self.session_best_time = lap_time
            logger.info(f"⭐ NEW SESSION BEST (from pending): {lap_time:.3f}s (Lap {self.pending_lap_number})")
        
        # Store lap
        self.laps[lap_id] = lap
        
        # Clear pending
        self.pending_lap_points = []
        self.pending_lap_number = 0
        self.pending_lap_track = ''
        self.pending_lap_car = ''
        
        # Enforce limit
        self._enforce_limit()
        
        logger.info(f"✅ Pending Lap {lap.lapNumber} stored: {lap_time:.3f}s ({len(lap.points)} points)")
        return lap
    
    def _enforce_limit(self):
        """Remove oldest laps if over limit, but always keep session best."""
        while len(self.laps) > self.max_laps:
            # Find oldest lap that isn't session best
            oldest_id = None
            oldest_time = float('inf')
            
            for lap_id, lap in self.laps.items():
                if lap_id != self.session_best_id and lap.completedAt < oldest_time:
                    oldest_time = lap.completedAt
                    oldest_id = lap_id
            
            if oldest_id:
                del self.laps[oldest_id]
                logger.debug(f"🗑️ Removed old lap {oldest_id} to enforce limit")
            else:
                break
    
    def get_lap(self, lap_id: str) -> Optional[LapData]:
        """Get a specific lap by ID."""
        return self.laps.get(lap_id)
    
    def get_session_best(self) -> Optional[LapData]:
        """Get the session best lap."""
        if self.session_best_id:
            return self.laps.get(self.session_best_id)
        return None
    
    def get_last_lap(self) -> Optional[LapData]:
        """Get the most recently completed lap."""
        if not self.laps:
            return None
        return max(self.laps.values(), key=lambda l: l.completedAt)
    
    def get_all_laps(self) -> List[Dict]:
        """Get all stored laps as list of dicts (without points for listing)."""
        result = []
        for lap in sorted(self.laps.values(), key=lambda l: l.completedAt, reverse=True):
            result.append({
                'id': lap.id,
                'lapNumber': lap.lapNumber,
                'lapTime': lap.lapTime,
                'isSessionBest': lap.isSessionBest,
                'trackName': lap.trackName,
                'carName': lap.carName,
                'completedAt': lap.completedAt,
                'deltaToSessionBest': lap.deltaToSessionBest,
                'pointCount': len(lap.points)
            })
        return result
    
    def delete_lap(self, lap_id: str) -> bool:
        """Delete a lap by ID. Cannot delete session best."""
        if lap_id == self.session_best_id:
            logger.warning("Cannot delete session best lap")
            return False
        
        if lap_id in self.laps:
            del self.laps[lap_id]
            logger.info(f"🗑️ Deleted lap {lap_id}")
            return True
        return False
    
    def reset_session(self):
        """Clear all laps (new session)."""
        self.laps.clear()
        self.session_best_id = None
        self.session_best_time = float('inf')
        self.current_lap_points = []
        self.recording_active = False
        self.pending_lap_points = []
        self.pending_lap_number = 0
        self.pending_lap_track = ''
        self.pending_lap_car = ''
        self.pending_lap_created_at = 0.0
        logger.info("🔄 Session reset - all laps cleared")
    
    def clear_pending_lap(self):
        """Clear pending lap data (e.g., on timeout)."""
        if self.pending_lap_points:
            logger.warning(f"🗑️ Clearing pending lap {self.pending_lap_number} ({len(self.pending_lap_points)} points) - never got valid time")
        self.pending_lap_points = []
        self.pending_lap_number = 0
        self.pending_lap_track = ''
        self.pending_lap_car = ''
        self.pending_lap_created_at = 0.0


# ============================================================================
# TELEMETRY SERVICE
# ============================================================================

class IRacingTelemetryService:
    """
    Minimal telemetry service that reads iRacing data and forwards it.
    NO ANALYSIS - only data extraction and basic event detection.
    """

    def __init__(self):
        self.ir = irsdk.IRSDK()
        self.connected = False
        self.clients: set = set()
        
        # Previous frame state (for event detection)
        self.prev_lap: int = 0
        self.prev_flag: int = 0
        self.prev_position: int = 0
        self.prev_in_pit: bool = False
        self.prev_incidents: int = 0
        self.prev_session_state: int = 0
        
        # Session tracking for session_joined event
        self.current_session_id: int = -1  # Track which session we're in
        self.session_joined_sent: bool = False  # Only send once per session
        
        # Minimal tracking for "helper" calculations
        self.fuel_used_history: deque = deque(maxlen=FUEL_HISTORY_SIZE)
        self.last_fuel_level: float = 0.0
        self.lap_start_fuel: float = 0.0
        
        # 🔊 SPOTTER - Proximity detection state
        self.spotter_state: str = 'clear'  # clear, car_left, car_right, three_wide
        self.spotter_frames_in_state: int = 0
        self.spotter_last_call: float = 0.0  # Timestamp of last spotter call
        self.spotter_cooldown: float = 1.0   # Min seconds between calls (except clear)
        self.spotter_still_interval: float = 2.0  # Seconds between "still there" calls
        
        # Timing
        self.last_snapshot_time: float = 0.0
        
        # 📊 LAP TELEMETRY CAPTURE
        self.lap_storage = LapStorageService(max_laps=MAX_STORED_LAPS)
        self.last_lap_capture_time: float = 0.0
        self.prev_lap_for_capture: int = 0
        
        # 🏁 OPPONENT SECTOR TRACKING
        self.sector_tracker = OpponentSectorTracker()

    def connect(self) -> bool:
        """Connect to iRacing."""
        if self.ir.startup():
            self.connected = True
            logger.info("✅ Connected to iRacing")
            return True
        return False

    def disconnect(self):
        """Disconnect from iRacing."""
        self.ir.shutdown()
        self.connected = False
        self._reset_state(preserve_laps=True)  # Keep lap data on disconnect
        logger.info("❌ Disconnected from iRacing")

    def _reset_state(self, preserve_laps: bool = False):
        """Reset all tracking state.
        
        Args:
            preserve_laps: If True, don't clear lap storage (for temporary disconnects)
        """
        self.prev_lap = 0
        self.prev_flag = 0
        self.prev_position = 0
        self.prev_in_pit = False
        self.prev_incidents = 0
        self.prev_session_state = 0
        self.fuel_used_history.clear()
        self.last_fuel_level = 0.0
        self.lap_start_fuel = 0.0
        # Session tracking reset
        self.current_session_id = -1
        self.session_joined_sent = False
        # Spotter reset
        self.spotter_state = 'clear'
        self.spotter_frames_in_state = 0
        self.spotter_last_call = 0.0
        # Lap capture reset - only clear if not preserving
        if not preserve_laps:
            self.lap_storage.reset_session()
        self.prev_lap_for_capture = 0
        # Sector tracker reset
        self.sector_tracker.reset()

    def is_session_active(self) -> bool:
        """Check if we're in an active session (not in menu/replay)."""
        if not self.connected or not self.ir.is_connected:
            return False
        session_state = self.ir['SessionState'] or 0
        # Active states: warmup, parade_laps, racing, checkered
        return session_state in (2, 3, 4, 5)

    # =========================================================================
    # PIT STOP CONTROL METHODS
    # =========================================================================

    def pit_command(self, command: str, value: int = 0) -> Dict[str, Any]:
        """Execute a pit command in iRacing.
        
        Args:
            command: One of: clear, ws, fuel, lf, rf, lr, rr, clear_tires, fr, clear_ws, clear_fr, clear_fuel
            value: For fuel: liters to add. For tires: pressure in KPa. 0 = use existing.
            
        Returns:
            Dict with success status and details
        """
        if not self.connected or not self.ir.is_connected:
            return {'success': False, 'error': 'Not connected to iRacing'}
        
        if not self.is_session_active():
            return {'success': False, 'error': 'Not in active session'}
        
        if command not in PIT_COMMAND_MODES:
            return {'success': False, 'error': f'Unknown command: {command}. Valid: {list(PIT_COMMAND_MODES.keys())}'}
        
        # Validate fuel range
        if command == 'fuel' and (value < 0 or value > 999):
            return {'success': False, 'error': 'Fuel must be 0-999 liters'}
        
        try:
            mode = PIT_COMMAND_MODES[command]
            self.ir.pit_command(mode, value)
            logger.info(f"🔧 Pit command executed: {command} = {value}")
            return {'success': True, 'command': command, 'value': value}
        except Exception as e:
            logger.error(f"❌ Pit command failed: {e}")
            return {'success': False, 'error': str(e)}

    def get_pit_status(self) -> Dict[str, Any]:
        """Get current pit stop configuration.
        
        Returns:
            Dict with current pit service flags and fuel amount
        """
        if not self.connected or not self.ir.is_connected:
            return {'success': False, 'error': 'Not connected to iRacing'}
        
        try:
            flags = self._safe_get('PitSvFlags', 0)
            fuel_to_add = self._safe_get('PitSvFuel', 0)
            
            # Decode flags
            status = {
                'success': True,
                'lfTireChange': bool(flags & PIT_SV_FLAGS['lf_tire_change']),
                'rfTireChange': bool(flags & PIT_SV_FLAGS['rf_tire_change']),
                'lrTireChange': bool(flags & PIT_SV_FLAGS['lr_tire_change']),
                'rrTireChange': bool(flags & PIT_SV_FLAGS['rr_tire_change']),
                'fuelFill': bool(flags & PIT_SV_FLAGS['fuel_fill']),
                'fuelToAdd': round(fuel_to_add, 1) if fuel_to_add else 0,
                'windshieldTearoff': bool(flags & PIT_SV_FLAGS['windshield_tearoff']),
                'fastRepair': bool(flags & PIT_SV_FLAGS['fast_repair']),
                'rawFlags': flags,
            }
            
            # Add summary
            tires_changing = []
            if status['lfTireChange']: tires_changing.append('LF')
            if status['rfTireChange']: tires_changing.append('RF')
            if status['lrTireChange']: tires_changing.append('LR')
            if status['rrTireChange']: tires_changing.append('RR')
            
            status['tiresChanging'] = tires_changing
            status['summary'] = self._format_pit_summary(status)
            
            return status
        except Exception as e:
            logger.error(f"❌ Get pit status failed: {e}")
            return {'success': False, 'error': str(e)}

    def _format_pit_summary(self, status: Dict) -> str:
        """Format pit status as human-readable summary."""
        parts = []
        
        if status['fuelFill'] and status['fuelToAdd'] > 0:
            parts.append(f"{status['fuelToAdd']}L fuel")
        
        if status['tiresChanging']:
            if len(status['tiresChanging']) == 4:
                parts.append("4 tires")
            else:
                parts.append(f"tires: {', '.join(status['tiresChanging'])}")
        
        if status['fastRepair']:
            parts.append("fast repair")
        
        if status['windshieldTearoff']:
            parts.append("windshield")
        
        return ', '.join(parts) if parts else 'Nothing configured'

    # =========================================================================
    # CHAT COMMAND METHODS
    # =========================================================================

    def chat_command_macro(self, macro_num: int) -> Dict[str, Any]:
        """Send a chat macro in iRacing.
        
        Args:
            macro_num: Macro number 1-15 (user-configured in iRacing)
            
        Returns:
            Dict with success status
        """
        if not self.connected or not self.ir.is_connected:
            return {'success': False, 'error': 'Not connected to iRacing'}
        
        if macro_num < 1 or macro_num > 15:
            return {'success': False, 'error': 'Macro number must be 1-15'}
        
        try:
            self.ir.chat_command_macro(macro_num)
            logger.info(f"💬 Chat macro {macro_num} sent")
            return {'success': True, 'macroNumber': macro_num}
        except Exception as e:
            logger.error(f"❌ Chat macro failed: {e}")
            return {'success': False, 'error': str(e)}

    def _safe_get(self, key: str, default: Any = None) -> Any:
        """Safely get a value from iRacing."""
        try:
            val = self.ir[key]
            return val if val is not None else default
        except Exception:
            return default

    def _get_active_flags(self, flag_value: int) -> List[str]:
        """Convert flag bitfield to list of active flag names."""
        flags = []
        for bit, name in FLAG_NAMES.items():
            if flag_value & bit:
                flags.append(name)
        return flags

    def _get_session_info(self, *keys: str) -> Any:
        """Navigate nested session info dict.
        
        pyirsdk gives us session info via ir['WeekendInfo'], ir['DriverInfo'], etc.
        First key is the top-level section, rest are nested keys.
        """
        try:
            if not keys:
                return None
            
            # First key is the top-level section (WeekendInfo, DriverInfo, Sessions, etc)
            data = self.ir[keys[0]]
            
            # Navigate remaining keys
            for key in keys[1:]:
                if data is None:
                    return None
                if isinstance(data, dict):
                    data = data.get(key)
                elif isinstance(data, list) and isinstance(key, int):
                    data = data[key] if key < len(data) else None
                else:
                    return None
            return data
        except Exception as e:
            logger.debug(f"_get_session_info error for keys {keys}: {e}")
            return None

    def _get_driver_info(self, car_idx: int) -> Dict[str, Any]:
        """Get driver info for a specific car index."""
        try:
            drivers = self.ir['DriverInfo']['Drivers']
            for driver in drivers:
                if driver.get('CarIdx') == car_idx:
                    return {
                        'name': driver.get('UserName', 'Unknown'),
                        'carNumber': driver.get('CarNumber', ''),
                        'iRating': driver.get('IRating', 0),
                        'carClass': driver.get('CarClassShortName', ''),
                        'carClassId': driver.get('CarClassID', 0),
                    }
        except Exception:
            pass
        return {'name': 'Unknown', 'carNumber': '', 'iRating': 0, 'carClass': '', 'carClassId': 0}

    def _get_nearby_opponents(self, player_idx: int, max_count: int = 5) -> List[Dict]:
        """Get nearby opponents with their raw data."""
        opponents = []
        try:
            num_cars = self._safe_get('CarIdxPosition', [])
            if not num_cars:
                return opponents

            player_lap_dist = self._safe_get('CarIdxLapDistPct', [])[player_idx] if player_idx < len(self._safe_get('CarIdxLapDistPct', [])) else 0
            player_position = self._safe_get('CarIdxPosition', [])[player_idx] if player_idx < len(num_cars) else 0

            lap_times = self._safe_get('CarIdxLastLapTime', [])
            positions = self._safe_get('CarIdxPosition', [])
            class_positions = self._safe_get('CarIdxClassPosition', [])
            est_times = self._safe_get('CarIdxEstTime', [])

            for car_idx in range(len(positions)):
                if car_idx == player_idx:
                    continue
                pos = positions[car_idx] if car_idx < len(positions) else 0
                if pos <= 0:  # Not in race
                    continue

                driver_info = self._get_driver_info(car_idx)
                opponent = {
                    'carIdx': car_idx,
                    'name': driver_info['name'],
                    'carNumber': driver_info['carNumber'],
                    'iRating': driver_info['iRating'],
                    'carClass': driver_info['carClass'],
                    'position': pos,
                    'classPosition': class_positions[car_idx] if car_idx < len(class_positions) else 0,
                    'lastLapTime': lap_times[car_idx] if car_idx < len(lap_times) else 0,
                    'gapToPlayer': est_times[car_idx] - est_times[player_idx] if car_idx < len(est_times) and player_idx < len(est_times) else 0,
                }
                opponents.append(opponent)

            # Sort by position difference from player
            opponents.sort(key=lambda x: abs(x['position'] - player_position))
            return opponents[:max_count]

        except Exception as e:
            logger.debug(f"Error getting opponents: {e}")

    def _detect_proximity(self, player_idx: int) -> Dict[str, Any]:
        """
        Detect cars alongside using iRacing native CarLeftRight variable.
        
        CarLeftRight values (from pyirsdk.py):
        0 = off
        1 = clear (no cars around us)
        2 = car_left (there is a car to our left)
        3 = car_right (there is a car to our right)
        4 = car_left_right (there are cars on each side)
        5 = two_cars_left (there are two cars to our left)
        6 = two_cars_right (there are two cars to our right)
        """
        result = {
            'car_left': False,
            'car_right': False,
            'car_left_dist': 0.5,  # Placeholder, native flags don't give dist
            'car_right_dist': 0.5,
        }
        
        try:
            car_left_right = self._safe_get('CarLeftRight', 0)
            
            # Check for cars on left (values 2, 4, 5)
            if car_left_right in (2, 4, 5):
                result['car_left'] = True
            
            # Check for cars on right (values 3, 4, 6)
            if car_left_right in (3, 4, 6):
                result['car_right'] = True
                
            return result
            
        except Exception as e:
            logger.debug(f"Error detecting proximity: {e}")
            return result

    def _update_spotter_state(self, proximity: Dict[str, Any]) -> Optional[str]:
        """
        Update spotter state machine and return event if state changed.
        
        Returns spotter event key or None:
        - 'car_left', 'car_right', 'three_wide' (initial calls)
        - 'clear', 'clear_left', 'clear_right', 'clear_all_around' (when cars move away)
        - 'still_left', 'still_right', 'still_three_wide' (persistence)
        """
        import time
        now = time.time()
        
        car_left = proximity['car_left']
        car_right = proximity['car_right']
        
        # Determine new state
        if car_left and car_right:
            new_state = 'three_wide'
        elif car_left:
            new_state = 'car_left'
        elif car_right:
            new_state = 'car_right'
        else:
            new_state = 'clear'
        
        event = None
        
        # State changed - call immediately
        if new_state != self.spotter_state:
            # ✅ IMPROVED: More specific clear calls based on previous state
            if new_state == 'clear':
                # Clear calls are IMMEDIATE - no cooldown (safety critical)
                if self.spotter_state == 'three_wide':
                    event = 'clear_all_around'
                elif self.spotter_state == 'car_left':
                    event = 'clear_left'
                elif self.spotter_state == 'car_right':
                    event = 'clear_right'
                else:
                    event = 'clear'  # Fallback
                self.spotter_last_call = now
            elif now - self.spotter_last_call >= self.spotter_cooldown:
                # Non-clear state changes respect cooldown
                event = new_state  # car_left, car_right, three_wide
                self.spotter_last_call = now
            
            self.spotter_state = new_state
            self.spotter_frames_in_state = 0
        else:
            # Same state - only call "still there" for threats, with proper timing
            if (self.spotter_state in ('car_left', 'car_right', 'three_wide') and
                now - self.spotter_last_call >= self.spotter_still_interval):
                
                # ✅ FIXED: Use numbered variants to match manifest keys
                # Rotate between variants 1, 2, 3 using frames_in_state counter
                variant_num = (self.spotter_frames_in_state % 3) + 1
                
                if self.spotter_state == 'car_left':
                    event = f'still_left_{variant_num}'
                elif self.spotter_state == 'car_right':
                    event = f'still_right_{variant_num}'
                elif self.spotter_state == 'three_wide':
                    event = f'still_three_wide_{variant_num}'
                
                self.spotter_last_call = now
                self.spotter_frames_in_state += 1  # Increment to rotate variants
        
        return event

    def _get_results_positions(self, session_num: int) -> List[Dict]:
        """Get ResultsPositions from current session - full standings with rich driver data."""
        try:
            session_info = self.ir['SessionInfo']
            if not session_info:
                return []
            
            sessions = session_info.get('Sessions', [])
            if session_num >= len(sessions):
                return []
            
            session_data = sessions[session_num]
            positions = session_data.get('ResultsPositions', [])
            
            if not positions:
                return []
            
            # Get driver info from DriverInfo for rich data
            driver_info = self.ir['DriverInfo']
            drivers = driver_info.get('Drivers', []) if driver_info else []
            
            # Build lookup dictionaries for all driver attributes
            driver_lookup = {}
            for d in drivers:
                car_idx = d.get('CarIdx')
                if car_idx is not None:
                    driver_lookup[car_idx] = {
                        'userName': d.get('UserName', 'Unknown'),
                        'carNumber': d.get('CarNumber', ''),
                        'iRating': d.get('IRating', 0),
                        'licString': d.get('LicString', ''),  # e.g., "A 4.99"
                        'licColor': d.get('LicColor', ''),
                        'carClass': d.get('CarClassShortName', ''),
                        'carClassColor': d.get('CarClassColor', ''),
                        'carName': d.get('CarScreenName', ''),
                        'teamName': d.get('TeamName', ''),
                        'clubName': d.get('ClubName', ''),
                    }
            
            # Get leader's fastest time for gap calculation
            leader_time = None
            for pos in positions:
                if pos.get('Position', 0) == 1:
                    leader_time = pos.get('FastestTime', -1)
                    break
            
            results = []
            for pos in positions:
                car_idx = pos.get('CarIdx', -1)
                driver = driver_lookup.get(car_idx, {})
                fastest_time = pos.get('FastestTime', -1)
                
                # Calculate gap to leader
                gap_to_leader = None
                if leader_time and leader_time > 0 and fastest_time > 0:
                    gap_to_leader = fastest_time - leader_time
                
                # Get opponent sectors from tracker
                sectors = self.sector_tracker.get_sectors(car_idx)
                
                results.append({
                    'position': pos.get('Position', 0),
                    'carIdx': car_idx,
                    'carNumber': driver.get('carNumber', ''),
                    'userName': driver.get('userName', 'Unknown'),
                    'iRating': driver.get('iRating', 0),
                    'license': driver.get('licString', ''),
                    'carClass': driver.get('carClass', ''),
                    'carName': driver.get('carName', ''),
                    'teamName': driver.get('teamName', ''),
                    'classPosition': pos.get('ClassPosition', 0),
                    'lap': pos.get('Lap', 0),
                    'lapsComplete': pos.get('LapsComplete', 0),
                    'lapsDriven': pos.get('LapsDriven', 0),
                    'lapsLed': pos.get('LapsLed', 0),
                    'fastestLap': pos.get('FastestLap', 0),
                    'fastestTime': fastest_time,
                    'lastTime': pos.get('LastTime', -1),
                    'gapToLeader': gap_to_leader,
                    'incidents': pos.get('Incidents', 0),
                    'reasonOutStr': pos.get('ReasonOutStr', 'Running'),
                    # Opponent sector times (virtual sectors)
                    's1': sectors.get('s1'),
                    's2': sectors.get('s2'),
                    's3': sectors.get('s3'),
                })
            
            return results
        except Exception as e:
            logger.debug(f"Error getting results positions: {e}")
            return []

    def _get_session_details(self, session_num: int) -> Dict[str, Any]:
        """Get detailed session info from SessionInfo YAML."""
        try:
            session_info = self.ir['SessionInfo']
            if not session_info:
                return {}
            
            sessions = session_info.get('Sessions', [])
            if session_num >= len(sessions):
                return {}
            
            session_data = sessions[session_num]
            
            return {
                'sessionName': session_data.get('SessionName', ''),
                'sessionType': session_data.get('SessionType', 'Unknown'),
                'sessionSubType': session_data.get('SessionSubType', ''),
                'sessionTime': session_data.get('SessionTime', ''),
                'sessionLaps': session_data.get('SessionLaps', ''),
                'trackRubberState': session_data.get('SessionTrackRubberState', ''),
                'numLeadChanges': session_data.get('ResultsNumLeadChanges', 0),
                'numCautionFlags': session_data.get('ResultsNumCautionFlags', 0),
                'numCautionLaps': session_data.get('ResultsNumCautionLaps', 0),
            }
        except Exception as e:
            logger.debug(f"Error getting session details: {e}")
            return {}

    def _get_driver_car_info(self) -> Dict[str, Any]:
        """Get car-specific info from DriverInfo."""
        try:
            driver_info = self.ir['DriverInfo']
            if not driver_info:
                return {}
            
            return {
                'estLapTime': driver_info.get('DriverCarEstLapTime', 0),
                'fuelMaxLtr': driver_info.get('DriverCarFuelMaxLtr', 0),
                'fuelKgPerLtr': driver_info.get('DriverCarFuelKgPerLtr', 0),
            }
        except Exception as e:
            logger.debug(f"Error getting driver car info: {e}")
            return {}

    def read_telemetry(self) -> Optional[Dict[str, Any]]:
        """
        Read all strategic telemetry data from iRacing.
        Returns raw data structure ready to send.
        """
        if not self.connected or not self.ir.is_connected:
            return None

        try:
            player_idx = self._safe_get('PlayerCarIdx', 0)
            session_num = self._safe_get('SessionNum', 0)
            
            # === TIMING ===
            current_lap = self._safe_get('Lap', 0)
            laps_completed = self._safe_get('LapCompleted', 0)
            last_lap_time = self._safe_get('LapLastLapTime', 0)
            best_lap_time = self._safe_get('LapBestLapTime', 0)
            lap_dist_pct = self._safe_get('LapDistPct', 0)
            current_lap_time = self._safe_get('LapCurrentLapTime', 0)
            
            # 🔍 SANITY CHECK: Lap Times
            # iRacing returns 0 or -1 for lap times when they're not yet valid
            # Mark as None so Gemini knows "no data" instead of "0 seconds"
            if last_lap_time <= 0:
                logger.debug(f"⚠️ Lap time sanity check: LastLapTime={last_lap_time} - marking as None")
                last_lap_time = None
            
            if best_lap_time <= 0:
                logger.debug(f"⚠️ Lap time sanity check: BestLapTime={best_lap_time} - marking as None")
                best_lap_time = None
            
            # Live deltas from iRacing (accurate!)
            delta_to_best = self._safe_get('LapDeltaToBestLap', 0)
            delta_to_best_ok = self._safe_get('LapDeltaToBestLap_OK', False)
            delta_to_session_best = self._safe_get('LapDeltaToSessionBestLap', 0)
            delta_to_session_best_ok = self._safe_get('LapDeltaToSessionBestLap_OK', False)
            
            # === POSITION ===
            positions = self._safe_get('CarIdxPosition', [])
            class_positions = self._safe_get('CarIdxClassPosition', [])
            
            position = positions[player_idx] if player_idx < len(positions) else 0
            class_position = class_positions[player_idx] if player_idx < len(class_positions) else 0
            
            # Count cars
            total_cars = sum(1 for p in positions if p > 0)
            
            # === SESSION CONTEXT DETECTION ===
            session_details = self._get_session_details(session_num)
            session_type = session_details.get('sessionType', 'Unknown')
            is_race = 'Race' in session_type
            is_lone_qualy = 'Qualify' in session_type  # Assume lone qualifying
            
            # === OPPONENT DATA MANAGEMENT ===
            gap_ahead = None
            gap_behind = None
            gap_to_leader = None
            traffic_data = None
            
            if is_lone_qualy:
                # LONE QUALIFYING: No opponents, no data needed
                pass
            else:
                # PRACTICE or RACE: Opponents present
                
                # 1. UPDATE OPPONENT SECTORS (Always track in multi-car sessions)
                session_time = self._safe_get('SessionTime', 0)
                self.sector_tracker.update(self.ir, session_time)
                
                # 2. TRAFFIC DATA (Always important - safety in Practice, rejoining in Race)
                dist_ahead = self._safe_get('CarDistAhead', -1.0)
                dist_behind = self._safe_get('CarDistBehind', -1.0)
                
                # Clean air threshold: 200 meters
                is_clean_air = (dist_ahead < 0 or dist_ahead > 200) and (dist_behind < 0 or dist_behind > 200)
                
                traffic_data = {
                    'distanceAhead': round(dist_ahead, 1) if dist_ahead >= 0 else None,
                    'distanceBehind': round(dist_behind, 1) if dist_behind >= 0 else None,
                    'isCleanAir': is_clean_air,
                }
                
                # 3. TIME GAPS (Only in RACE - irrelevant in Practice)
                if is_race:
                    # Use CarIdxF2Time (time behind leader) for accurate race gaps
                    f2_times = self._safe_get('CarIdxF2Time', [])
                    player_f2_time = f2_times[player_idx] if player_idx < len(f2_times) else 0
                    
                    for idx, pos in enumerate(positions):
                        if idx == player_idx or pos <= 0 or idx >= len(f2_times):
                            continue
                        
                        if pos == position - 1:  # Car ahead
                            gap_ahead = player_f2_time - f2_times[idx]
                        elif pos == position + 1:  # Car behind
                            gap_behind = f2_times[idx] - player_f2_time
                        elif pos == 1:  # Leader
                            gap_to_leader = player_f2_time - f2_times[idx]

            # === FUEL ===
            fuel_level = self._safe_get('FuelLevel', 0)
            fuel_pct = self._safe_get('FuelLevelPct', 0)
            is_on_track = self._safe_get('IsOnTrack', False)
            
            # 🔍 SANITY CHECK: Fuel Level
            # iRacing sometimes reports FuelLevel=0.0 during initial connection or momentarily
            # If fuel is < 0.5L (too low to run) AND car is on track, it's likely a data glitch
            # Mark as None so Gemini knows "no data" instead of "empty tank"
            if fuel_level < 0.5 and is_on_track:
                # Only log if it was valid before to avoid spam
                if self.last_fuel_level > 0.5:
                    logger.debug(f"⚠️ Fuel sanity check: FuelLevel={fuel_level} while IsOnTrack=True - marking as None (likely data glitch)")
                fuel_level = None
                fuel_pct = None
            
            # Track fuel used per lap (only if fuel_level is valid)
            fuel_used_last_lap = 0.0
            if fuel_level is not None and current_lap > self.prev_lap and self.lap_start_fuel > 0:
                fuel_used_last_lap = self.lap_start_fuel - fuel_level
                if fuel_used_last_lap > 0:
                    self.fuel_used_history.append(fuel_used_last_lap)
                self.lap_start_fuel = fuel_level
            elif self.lap_start_fuel == 0 and fuel_level is not None:
                self.lap_start_fuel = fuel_level

            fuel_per_lap_avg = 0.0
            if self.fuel_used_history:
                fuel_per_lap_avg = sum(self.fuel_used_history) / len(self.fuel_used_history)
            
            # Estimate laps remaining based on fuel (only if fuel_level is valid)
            estimated_laps_remaining = 0.0
            if fuel_level is not None and fuel_level > 0 and fuel_per_lap_avg > 0:
                estimated_laps_remaining = fuel_level / fuel_per_lap_avg

            # === SECTORS ===
            # iRacing sectors: 1 = first third, 2 = middle third, 3 = final third
            current_sector = 1  # Default to sector 1
            if lap_dist_pct > 0.66:
                current_sector = 3  # Final sector
            elif lap_dist_pct > 0.33:
                current_sector = 2  # Middle sector
            # else: stays 1 (first sector)
                
            # Try to get live sector times if available (rarely populated live)
            # split_time_1 = self._safe_get('SplitTime1', 0.0)

            # === PIT INFO ===
            on_pit_road = self._safe_get('OnPitRoad', False)
            in_pit_stall = self._safe_get('PlayerCarInPitStall', False)
            pits_open = self._safe_get('PitsOpen', True)
            pit_limiter = bool(self._safe_get('EngineWarnings', 0) & 0x10)
            pit_repair_left = self._safe_get('PitRepairLeft', 0)
            pit_opt_repair_left = self._safe_get('PitOptRepairLeft', 0)
            
            # === FAST REPAIRS ===
            fast_repair_available = self._safe_get('FastRepairAvailable', 0)
            fast_repair_used = self._safe_get('FastRepairUsed', 0)

            # === SESSION ===
            session_state = self._safe_get('SessionState', 0)
            session_time = self._safe_get('SessionTime', 0)
            session_time_remain = self._safe_get('SessionTimeRemain', 0)
            session_laps_remain = self._safe_get('SessionLapsRemainEx', 0)  # Use Ex version
            session_laps_total = self._safe_get('SessionLapsTotal', 0)
            race_laps = self._safe_get('RaceLaps', 0)
            
            # Session info from YAML
            track_name = self._get_session_info('WeekendInfo', 'TrackDisplayName') or 'Unknown'
            track_config = self._get_session_info('WeekendInfo', 'TrackConfigName') or ''
            track_length = self._get_session_info('WeekendInfo', 'TrackLength') or ''
            car_name = self._get_session_info('DriverInfo', 'Drivers', player_idx, 'CarScreenName') or 'Unknown'
            
            # Session details already retrieved above for gap calculation

            # === TRACK CONDITIONS ===
            track_temp = self._safe_get('TrackTempCrew', 0)  # Correct variable
            air_temp = self._safe_get('AirTemp', 0)
            track_wetness = self._safe_get('TrackWetness', 0)
            skies = self._safe_get('Skies', 0)
            weather_wet = self._safe_get('WeatherDeclaredWet', False)

            # === FLAGS ===
            current_flags = self._safe_get('SessionFlags', 0)
            flag_list = self._get_active_flags(current_flags)

            # === INCIDENTS ===
            incidents = self._safe_get('PlayerCarMyIncidentCount', 0)
            team_incidents = self._safe_get('PlayerCarTeamIncidentCount', 0)
            incident_limit = self._get_session_info('WeekendInfo', 'WeekendOptions', 'IncidentLimit') or 0

            # === TIRES ===
            tire_sets_available = self._safe_get('TireSetsAvailable', 255)
            tire_sets_used = self._safe_get('TireSetsUsed', 0)
            tire_compound = self._safe_get('PlayerTireCompound', 0)
            
            # === CAR INFO from DriverInfo ===
            car_info = self._get_driver_car_info()

            # === STANDINGS (ResultsPositions) ===
            standings = self._get_results_positions(session_num)

            # Build telemetry object
            telemetry = {
                'timestamp': int(time.time() * 1000),
                'simulator': 'iRacing',
                
                # Timing
                'timing': {
                    'currentLap': current_lap,
                    'lapsCompleted': laps_completed,
                    'lapDistPct': round(lap_dist_pct, 4),
                    'currentLapTime': round(current_lap_time, 3),
                    'lastLapTime': round(last_lap_time, 3) if last_lap_time is not None else None,
                    'bestLapTime': round(best_lap_time, 3) if best_lap_time is not None else None,
                    # Live deltas from iRacing
                    'deltaToBest': round(delta_to_best, 3) if delta_to_best_ok else None,
                    'deltaToSessionBest': round(delta_to_session_best, 3) if delta_to_session_best_ok else None,
                    # Sectors
                    'currentSector': current_sector,
                },
                
                # Position
                'position': {
                    'overall': position,
                    'class': class_position,
                    'totalCars': total_cars,
                },
                
                # Gaps (raw seconds) - None in Practice/Qualify, actual times in Race
                'gaps': {
                    'ahead': round(gap_ahead, 3) if gap_ahead is not None else None,
                    'behind': round(gap_behind, 3) if gap_behind is not None else None,
                    'toLeader': round(gap_to_leader, 3) if gap_to_leader is not None else None,
                },
                
                # Traffic - Physical proximity (meters) - None in lone qualifying
                'traffic': traffic_data,
                
                # Fuel
                'fuel': {
                    'level': round(fuel_level, 2) if fuel_level is not None else None,
                    'pct': round(fuel_pct * 100, 1) if fuel_pct is not None else None,
                    'usedLastLap': round(fuel_used_last_lap, 3),
                    'perLapAvg': round(fuel_per_lap_avg, 3),
                    'estimatedLapsRemaining': round(estimated_laps_remaining, 1),
                    'maxLtr': car_info.get('fuelMaxLtr', 0),
                },
                
                # Pit
                'pit': {
                    'inPitLane': on_pit_road,
                    'inPitStall': in_pit_stall,
                    'pitsOpen': pits_open,
                    'pitLimiterOn': pit_limiter,
                    'repairTimeLeft': round(pit_repair_left, 1),
                    'optRepairTimeLeft': round(pit_opt_repair_left, 1),
                    'fastRepairAvailable': fast_repair_available,
                    'fastRepairUsed': fast_repair_used,
                },
                
                # Session
                'session': {
                    'type': session_details.get('sessionType', 'Unknown'),
                    'name': session_details.get('sessionName', ''),
                    'state': SESSION_STATE_NAMES.get(session_state, 'unknown'),
                    'stateRaw': session_state,
                    'timeRemaining': round(session_time_remain, 1) if session_time_remain > 0 else 0,
                    'lapsRemaining': session_laps_remain if session_laps_remain > 0 else 0,
                    'lapsTotal': session_laps_total if session_laps_total > 0 else 0,
                    'raceLaps': race_laps,
                    'trackName': track_name,
                    'trackConfig': track_config,
                    'trackLength': track_length,
                    'carName': car_name,
                    'estLapTime': car_info.get('estLapTime', 0),
                    # From ResultsPositions
                    'trackRubberState': session_details.get('trackRubberState', ''),
                    'numLeadChanges': session_details.get('numLeadChanges', 0),
                    'numCautionFlags': session_details.get('numCautionFlags', 0),
                    'numCautionLaps': session_details.get('numCautionLaps', 0),
                },
                
                # Track conditions
                'track': {
                    'tempCelsius': round(track_temp, 1),
                    'airTempCelsius': round(air_temp, 1),
                    'wetness': track_wetness,
                    'wetnessName': TRACK_WETNESS_NAMES.get(track_wetness, 'unknown'),
                    'skies': skies,  # 0=clear, 1=partly cloudy, 2=mostly cloudy, 3=overcast
                    'weatherDeclaredWet': weather_wet,
                },
                
                # Flags
                'flags': {
                    'active': flag_list,
                    'raw': current_flags,
                },
                
                # Incidents
                'incidents': {
                    'count': incidents,
                    'teamCount': team_incidents,
                    'limit': incident_limit if isinstance(incident_limit, int) else 0,
                },
                
                # Tires
                'tires': {
                    'setsAvailable': tire_sets_available,
                    'setsUsed': tire_sets_used,
                    'compound': tire_compound,
                },
                
                # Full standings from ResultsPositions
                'standings': standings,
            }

            # Update tracking for next frame
            self.prev_lap = current_lap
            self.prev_flag = current_flags
            self.prev_position = position
            self.prev_in_pit = on_pit_road
            self.prev_incidents = incidents
            self.prev_session_state = session_state
            self.last_fuel_level = fuel_level

            return telemetry

        except Exception as e:
            logger.error(f"Error reading telemetry: {e}")
            return None

    def capture_lap_telemetry(self) -> Optional[LapData]:
        """
        Capture high-frequency telemetry data for lap comparison graphs.
        Called at 20Hz. Returns completed LapData when a lap finishes.
        
        Captures: Speed, Throttle, Brake, Gear, RPM, Steering, LapDistPct
        """
        if not self.connected or not self.ir.is_connected:
            return None
        
        try:
            # Check timing
            now = time.time()
            if now - self.last_lap_capture_time < LAP_CAPTURE_INTERVAL:
                return None
            self.last_lap_capture_time = now
            
            # Get basic info first (BEFORE any filtering)
            player_idx = self._safe_get('PlayerCarIdx', 0)
            current_lap = self._safe_get('Lap', 0)
            lap_dist_pct = self._safe_get('LapDistPct', 0)
            last_lap_time = self._safe_get('LapLastLapTime', 0)
            
            # ========================================
            # CHECK FOR PENDING LAP WAITING FOR TIME
            # ========================================
            # iRacing often returns 0 for LapLastLapTime at exact moment of lap change
            # So we store the lap data and wait for the time to appear
            if len(self.lap_storage.pending_lap_points) > 0:
                # Timeout pending laps after 10 seconds
                pending_age = now - self.lap_storage.pending_lap_created_at
                if pending_age > 10.0:
                    logger.warning(f"⏰ Pending lap timed out after {pending_age:.1f}s - clearing")
                    self.lap_storage.clear_pending_lap()
                elif last_lap_time > 0:
                    logger.info(f"📊 Pending lap now has valid time: {last_lap_time:.3f}s - saving!")
                    completed_lap = self.lap_storage.save_pending_lap(last_lap_time)
                    if completed_lap:
                        logger.info(f"✅ PENDING LAP SAVED: {completed_lap.id} with {len(completed_lap.points)} points, time: {last_lap_time:.3f}s")
                        return completed_lap
                    else:
                        logger.warning(f"⚠️ PENDING LAP NOT SAVED - save_pending_lap returned None")
            
            # Detect lap change FIRST (before any surface filtering)
            if current_lap > self.prev_lap_for_capture and self.prev_lap_for_capture > 0:
                logger.info(f"🏁 LAP CHANGE DETECTED: {self.prev_lap_for_capture} -> {current_lap} (points: {len(self.lap_storage.current_lap_points)})")
                
                # IMPORTANT: Update prev_lap IMMEDIATELY to prevent loop on error
                prev_lap = self.prev_lap_for_capture
                self.prev_lap_for_capture = current_lap
                
                # Complete previous lap
                track_name = self._get_session_info('WeekendInfo', 'TrackDisplayName') or 'Unknown'
                track_config = self._get_session_info('WeekendInfo', 'TrackConfigName') or ''
                if track_config:
                    track_name = f"{track_name} - {track_config}"
                car_name = self._get_session_info('DriverInfo', 'Drivers', player_idx, 'CarScreenName') or 'Unknown'
                
                completed_lap = None
                if last_lap_time > 0:
                    # Time is available immediately - save lap now
                    logger.info(f"📊 Completing lap with time: {last_lap_time:.3f}s")
                    completed_lap = self.lap_storage.complete_lap(
                        lap_time=last_lap_time,
                        track_name=track_name,
                        car_name=car_name
                    )
                    if completed_lap:
                        logger.info(f"✅ LAP SAVED: {completed_lap.id} with {len(completed_lap.points)} points")
                    else:
                        logger.warning(f"⚠️ LAP NOT SAVED - complete_lap returned None")
                else:
                    # Time not available yet - store as pending
                    logger.warning(f"⚠️ LapLastLapTime=0 at lap change - storing as PENDING lap")
                    if len(self.lap_storage.current_lap_points) > MIN_LAP_POINTS:
                        self.lap_storage.pending_lap_points = self.lap_storage.current_lap_points.copy()
                        self.lap_storage.pending_lap_number = prev_lap
                        self.lap_storage.pending_lap_track = track_name
                        self.lap_storage.pending_lap_car = car_name
                        self.lap_storage.pending_lap_created_at = now  # Track when pending was created
                        logger.info(f"📦 Stored {len(self.lap_storage.pending_lap_points)} points as pending, waiting for lap time...")
                    else:
                        logger.warning(f"⚠️ Lap {prev_lap} has too few points ({len(self.lap_storage.current_lap_points)}) - discarding")
                
                # Start recording new lap
                self.lap_storage.start_lap(current_lap)
                
                return completed_lap
            
            # First lap detection
            if current_lap > 0 and self.prev_lap_for_capture == 0:
                logger.info(f"🚀 FIRST LAP DETECTED: Starting capture for lap {current_lap}")
                self.lap_storage.start_lap(current_lap)
                self.prev_lap_for_capture = current_lap
            
            # Only capture telemetry points when on track
            track_surfaces = self._safe_get('CarIdxTrackSurface', [])
            player_surface = track_surfaces[player_idx] if player_idx < len(track_surfaces) else -1
            
            # TrackSurface: 1=OffTrack, 2=InPitStall, 3=ApproachingPits, 4=OnTrack
            if player_surface not in (1, 3, 4):
                return None
            
            # Capture telemetry point
            if self.lap_storage.recording_active:
                # Read high-frequency data
                speed_ms = self._safe_get('Speed', 0)
                speed_kmh = speed_ms * 3.6  # m/s to km/h
                
                throttle = self._safe_get('Throttle', 0)
                brake = self._safe_get('Brake', 0)
                gear = self._safe_get('Gear', 0)
                rpm = self._safe_get('RPM', 0)
                steering = self._safe_get('SteeringWheelAngle', 0)
                
                point = TelemetryPoint(
                    distancePct=round(lap_dist_pct, 4),
                    speed=round(speed_kmh, 1),
                    throttle=round(throttle, 3),
                    brake=round(brake, 3),
                    gear=int(gear),
                    rpm=round(rpm, 0),
                    steeringAngle=round(steering, 4)
                )
                
                self.lap_storage.add_point(point)
            
            return None
            
        except Exception as e:
            logger.error(f"Error capturing lap telemetry: {e}")
            return None

    def detect_events(self, telemetry: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Detect discrete events by comparing current frame to previous.
        Returns list of events that occurred.
        """
        import time  # For spotter timing control
        events = []
        
        if not telemetry:
            return events

        current_lap = telemetry['timing']['currentLap']
        current_flags = telemetry['flags']['raw']
        current_position = telemetry['position']['overall']
        current_in_pit = telemetry['pit']['inPitLane']
        current_incidents = telemetry['incidents']['count']
        current_session_state = telemetry['session']['stateRaw']
        
        # Get session number to track session changes
        session_num = self._safe_get('SessionNum', 0)
        
        # 🎯 SESSION JOINED - Send full participant table when joining a new session
        if session_num != self.current_session_id or not self.session_joined_sent:
            self.current_session_id = session_num
            self.session_joined_sent = True
            
            # Get full standings table
            standings = telemetry.get('standings', [])
            
            # Get WeekendInfo for additional context
            weekend_info = self.ir['WeekendInfo'] or {}
            
            # Calculate class distribution
            class_counts = {}
            for entry in standings:
                car_class = entry.get('carClass', 'Unknown')
                class_counts[car_class] = class_counts.get(car_class, 0) + 1
            
            # Calculate SoF (Strength of Field) - proper average
            iratings = [e.get('iRating', 0) for e in standings if e.get('iRating', 0) > 0]
            sof = round(sum(iratings) / len(iratings)) if iratings else 0
            
            events.append({
                'type': 'session_joined',
                'data': {
                    'sessionType': telemetry['session']['type'],
                    'sessionName': telemetry['session']['name'],
                    'trackName': telemetry['session']['trackName'],
                    'trackConfig': telemetry['session']['trackConfig'],
                    'trackLength': telemetry['session']['trackLength'],
                    'carName': telemetry['session']['carName'],
                    'totalDrivers': len(standings),
                    'classDistribution': class_counts,
                    'strengthOfField': sof,
                    'weatherDeclaredWet': telemetry['track'].get('weatherDeclaredWet', False),
                    'trackTemp': telemetry['track'].get('tempCelsius', 0),
                    'airTemp': telemetry['track'].get('airTempCelsius', 0),
                    'standings': standings,  # Full participant table!
                    'playerPosition': current_position,
                    'playerCarNumber': self._get_driver_info(self._safe_get('PlayerCarIdx', 0)).get('carNumber', ''),
                }
            })
            logger.info(f"📋 SESSION JOINED: {len(standings)} drivers, SoF: {sof//1000}k")

        # Lap completed
        if current_lap > self.prev_lap and self.prev_lap > 0:
            events.append({
                'type': 'lap_complete',
                'data': {
                    'lap': current_lap - 1,
                    'lapTime': telemetry['timing']['lastLapTime'],
                    'delta': telemetry['timing'].get('deltaToBest'),  # Can be None
                    'position': current_position,
                    'fuelUsed': telemetry['fuel']['usedLastLap'],
                }
            })

        # Flag change
        if current_flags != self.prev_flag:
            events.append({
                'type': 'flag_change',
                'data': {
                    'flags': telemetry['flags']['active'],
                    'previousRaw': self.prev_flag,
                    'currentRaw': current_flags,
                }
            })

        # Position change
        if current_position != self.prev_position and self.prev_position > 0:
            change = self.prev_position - current_position  # Positive = gained
            events.append({
                'type': 'position_change',
                'data': {
                    'from': self.prev_position,
                    'to': current_position,
                    'change': change,
                    'gapAhead': telemetry['gaps']['ahead'],
                    'gapBehind': telemetry['gaps']['behind'],
                }
            })

        # Pit entry/exit
        if current_in_pit != self.prev_in_pit:
            events.append({
                'type': 'pit_entry' if current_in_pit else 'pit_exit',
                'data': {
                    'fuelLevel': telemetry['fuel']['level'],
                    'inPitStall': telemetry['pit']['inPitStall'],
                }
            })

        # New incident
        if current_incidents > self.prev_incidents:
            events.append({
                'type': 'incident',
                'data': {
                    'count': current_incidents,
                    'limit': telemetry['incidents']['limit'],
                    'added': current_incidents - self.prev_incidents,
                }
            })

        # Session state change
        if current_session_state != self.prev_session_state:
            events.append({
                'type': 'session_state_change',
                'data': {
                    'from': SESSION_STATE_NAMES.get(self.prev_session_state, 'unknown'),
                    'to': telemetry['session']['state'],
                }
            })

        # 🔊 SPOTTER - Re-enabled via native iRacing flags!
        # This replaces the old SimHub dependency
        # 🔊 SPOTTER - Only during active racing (not in garage/pits/qualifying/offline solo)
        # ✅ FIXED: Disable spotter proximity calls during qualifying sessions
        session_type = telemetry.get('session', {}).get('type', '').lower()
        is_qualifying = 'qualify' in session_type or 'qual' in session_type
        
        # ✅ FIXED: Contar coches REALES usando DriverInfo['Drivers']
        # NumCarClasses = número de CLASES (siempre >= 1)
        # CarIdxLapDistPct = array de 64 posiciones (siempre 64)
        # DriverInfo['Drivers'] = lista de pilotos REALES en sesión
        try:
            driver_info = self.ir['DriverInfo']
            drivers = driver_info.get('Drivers', []) if driver_info else []
            # Filtrar el pace car (CarIdx 0 suele ser pace car en algunas sesiones)
            real_drivers = [d for d in drivers if d.get('CarIsPaceCar', 0) == 0]
            num_cars = len(real_drivers)
        except:
            num_cars = 0
        
        if (self.is_session_active() and
            not self._safe_get('OnPitRoad', False) and
            not self._safe_get('InGarage', False) and
            not is_qualifying and  # ✅ No spotter en qualifying
            num_cars > 1):  # ✅ FIXED: Solo si hay más de 1 coche REAL
            
            proximity = self._detect_proximity(self._safe_get('PlayerCarIdx', 0))
            spotter_event = self._update_spotter_state(proximity)
            
            if spotter_event:
                # Extra safety: prevent duplicate calls
                current_time = time.time()
                if current_time - getattr(self, '_last_spotter_emit', 0) >= 0.5:
                    events.append({
                        'type': 'spotter',
                        'data': {
                            'call': spotter_event,
                            'proximity': proximity
                        }
                    })
                    self._last_spotter_emit = current_time

        return events


# ============================================================================
# WEBSOCKET SERVER
# ============================================================================

class TelemetryWebSocketServer:
    """WebSocket server that broadcasts telemetry to connected clients."""

    def __init__(self, telemetry_service: IRacingTelemetryService):
        self.telemetry = telemetry_service
        self.clients: set = set()
        self.last_snapshot: Optional[Dict] = None

    def clear_snapshot(self):
        """Clear the last snapshot (called when iRacing disconnects)."""
        self.last_snapshot = None
        logger.info("🗑️ Snapshot cleared - iRacing disconnected")

    async def register(self, websocket):
        """Register a new client."""
        self.clients.add(websocket)
        logger.info(f"📡 Client connected. Total: {len(self.clients)}")
        
        # Send last snapshot to new client (only if valid)
        if self.last_snapshot:
            try:
                await websocket.send(json.dumps(self.last_snapshot))
            except Exception as e:
                logger.error(f"Error sending initial snapshot: {e}")

    async def unregister(self, websocket):
        """Unregister a client."""
        self.clients.discard(websocket)
        logger.info(f"📡 Client disconnected. Total: {len(self.clients)}")

    async def broadcast(self, message: Dict):
        """Broadcast message to all connected clients."""
        if not self.clients:
            return
        
        message_str = json.dumps(message)
        dead_clients = set()
        
        for client in self.clients:
            try:
                await client.send(message_str)
            except websockets.exceptions.ConnectionClosed:
                dead_clients.add(client)
            except Exception as e:
                logger.error(f"Broadcast error: {e}")
                dead_clients.add(client)
        
        # Clean up dead clients
        for client in dead_clients:
            self.clients.discard(client)

    async def handler(self, websocket):
        """Handle incoming WebSocket connections."""
        await self.register(websocket)
        try:
            async for message in websocket:
                # Handle incoming commands from clients
                await self._handle_command(websocket, message)
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            await self.unregister(websocket)

    async def _handle_command(self, websocket, message: str):
        """Handle incoming command messages from clients."""
        try:
            data = json.loads(message)
            msg_type = data.get('type', '')
            
            if msg_type == 'pit_command':
                # Execute pit command
                command = data.get('command', '')
                value = data.get('value', 0)
                result = self.telemetry.pit_command(command, value)
                
                response = {
                    'type': 'pit_command_response',
                    'requestId': data.get('requestId'),
                    'result': result,
                }
                await websocket.send(json.dumps(response))
                logger.info(f"🔧 Pit command response: {result}")
                
            elif msg_type == 'get_pit_status':
                # Get current pit configuration
                result = self.telemetry.get_pit_status()
                
                response = {
                    'type': 'pit_status_response',
                    'requestId': data.get('requestId'),
                    'result': result,
                }
                await websocket.send(json.dumps(response))
                logger.info(f"📋 Pit status response: {result.get('summary', 'N/A')}")
                
            elif msg_type == 'chat_command':
                # Send chat macro
                macro_num = data.get('macroNumber', 0)
                result = self.telemetry.chat_command_macro(macro_num)
                
                response = {
                    'type': 'chat_command_response',
                    'requestId': data.get('requestId'),
                    'result': result,
                }
                await websocket.send(json.dumps(response))
                logger.info(f"💬 Chat command response: {result}")
                
            else:
                logger.debug(f"Unknown message type: {msg_type}")
                
        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON message: {e}")
        except Exception as e:
            logger.error(f"Error handling command: {e}")


# ============================================================================
# MAIN LOOP
# ============================================================================

async def telemetry_loop(telemetry: IRacingTelemetryService, server: TelemetryWebSocketServer):
    """Main telemetry reading and broadcasting loop (1Hz for strategic data)."""
    
    while True:
        # Try to connect to iRacing if not connected
        if not telemetry.connected:
            if telemetry.connect():
                logger.info("🏎️  iRacing connection established")
            else:
                logger.debug("Waiting for iRacing...")
                await asyncio.sleep(RECONNECT_DELAY)
                continue

        # Check if still connected
        if not telemetry.ir.is_connected:
            logger.warning("⚠️  iRacing disconnected")
            telemetry.disconnect()
            
            # 🔧 FIX: Clear stale snapshot to prevent phantom data
            server.clear_snapshot()
            
            # 🔧 FIX: Send DISCONNECTED event to frontend
            disconnected_event = {
                'type': 'disconnected',
                'timestamp': int(time.time() * 1000),
                'message': 'iRacing disconnected'
            }
            await server.broadcast(disconnected_event)
            logger.info("📡 DISCONNECTED event sent to clients")
            
            await asyncio.sleep(RECONNECT_DELAY)
            continue

        # Read telemetry
        data = telemetry.read_telemetry()
        
        # Always send telemetry if we have data (even in garage/pit)
        # This lets Gemini know track/car info before you're on track
        if data:
            current_time = time.time()
            session_active = telemetry.is_session_active()
            
            # Log session state periodically for debugging
            session_state = telemetry.ir['SessionState'] or 0
            if int(current_time) % 30 == 0:  # Every 30 seconds
                logger.debug(f"📊 SessionState: {session_state} ({'active' if session_active else 'inactive'})")
            
            # Detect events (only in active session)
            events = telemetry.detect_events(data) if session_active else []
            
            # Send events immediately
            for event in events:
                event_message = {
                    'type': 'event',
                    'timestamp': int(current_time * 1000),
                    'event': event,
                    'data': data,
                }
                await server.broadcast(event_message)
                logger.info(f"🎯 Event: {event['type']}")

            # Send snapshot at interval (or if first snapshot)
            if current_time - telemetry.last_snapshot_time >= SNAPSHOT_INTERVAL:
                snapshot = {
                    'type': 'snapshot',
                    'timestamp': int(current_time * 1000),
                    'data': data,
                }
                server.last_snapshot = snapshot
                await server.broadcast(snapshot)
                telemetry.last_snapshot_time = current_time
                logger.info(f"📊 Snapshot sent to {len(server.clients)} clients (session: {session_state})")

        await asyncio.sleep(POLL_INTERVAL)


async def lap_capture_loop(telemetry: IRacingTelemetryService, server: TelemetryWebSocketServer):
    """High-frequency lap telemetry capture loop (20Hz)."""
    
    while True:
        if not telemetry.connected or not telemetry.ir.is_connected:
            await asyncio.sleep(0.5)
            continue
        
        # Capture telemetry point and check for completed lap
        completed_lap = telemetry.capture_lap_telemetry()
        
        # If a lap was completed, broadcast the event AND full data
        if completed_lap:
            # First send the event notification (lightweight)
            lap_event = {
                'type': 'lap_recorded',
                'timestamp': int(time.time() * 1000),
                'lap': {
                    'id': completed_lap.id,
                    'lapNumber': completed_lap.lapNumber,
                    'lapTime': completed_lap.lapTime,
                    'isSessionBest': completed_lap.isSessionBest,
                    'trackName': completed_lap.trackName,
                    'carName': completed_lap.carName,
                    'pointCount': len(completed_lap.points),
                    'deltaToSessionBest': completed_lap.deltaToSessionBest
                }
            }
            await server.broadcast(lap_event)
            
            # Then send the full lap data with all telemetry points
            lap_data_msg = {
                'type': 'lap_data',
                'timestamp': int(time.time() * 1000),
                'lapData': {
                    'id': completed_lap.id,
                    'lapNumber': completed_lap.lapNumber,
                    'lapTime': completed_lap.lapTime,
                    'isSessionBest': completed_lap.isSessionBest,
                    'trackName': completed_lap.trackName,
                    'carName': completed_lap.carName,
                    'completedAt': completed_lap.completedAt,
                    'points': completed_lap.points,  # Full telemetry points array
                    'deltaToSessionBest': completed_lap.deltaToSessionBest
                }
            }
            await server.broadcast(lap_data_msg)
            
            logger.info(f"📊 Lap {completed_lap.lapNumber} sent: {completed_lap.lapTime:.3f}s ({len(completed_lap.points)} points)")
        
        await asyncio.sleep(LAP_CAPTURE_INTERVAL)


async def main():
    """Main entry point."""
    logger.info("=" * 50)
    logger.info("iRacing Telemetry Service")
    logger.info("=" * 50)
    logger.info(f"WebSocket port: {WEBSOCKET_PORT}")
    logger.info(f"Snapshot interval: {SNAPSHOT_INTERVAL}s")
    logger.info(f"Poll interval: {POLL_INTERVAL}s")
    logger.info(f"Lap capture interval: {LAP_CAPTURE_INTERVAL}s (20Hz)")
    logger.info(f"Max stored laps: {MAX_STORED_LAPS}")
    logger.info("=" * 50)

    # Create services
    telemetry = IRacingTelemetryService()
    server = TelemetryWebSocketServer(telemetry)

    # Start WebSocket server
    ws_server = await websockets.serve(
        server.handler,
        "0.0.0.0",
        WEBSOCKET_PORT
    )
    logger.info(f"✅ WebSocket server started on ws://localhost:{WEBSOCKET_PORT}")

    # Run both loops concurrently
    try:
        await asyncio.gather(
            telemetry_loop(telemetry, server),
            lap_capture_loop(telemetry, server)
        )
    except KeyboardInterrupt:
        logger.info("Shutting down...")
    finally:
        telemetry.disconnect()
        ws_server.close()
        await ws_server.wait_closed()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nShutdown requested")
