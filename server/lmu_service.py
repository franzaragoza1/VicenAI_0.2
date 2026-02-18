#!/usr/bin/env python3
"""
Le Mans Ultimate Telemetry Service - MINIMAL DATA PIPELINE
==========================================================
Reads strategic data from LMU and sends to Node.js via WebSocket.

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

# Add LMU library to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'lib'))

try:
    from pyLMUSharedMemory import lmu_mmap, lmu_data
except ImportError:
    print("[ERROR] pyLMUSharedMemory not found. Check lib/pyLMUSharedMemory")
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
POLL_INTERVAL = 1.0      # Read LMU at 1Hz (strategic data)
RECONNECT_DELAY = 5.0    # Seconds to wait before reconnecting to LMU
FUEL_HISTORY_SIZE = 10   # Ring buffer size for fuel calculations

# === LAP TELEMETRY CAPTURE ===
LAP_CAPTURE_INTERVAL = 0.05  # 20Hz for detailed lap telemetry
MAX_STORED_LAPS = 10         # Maximum laps to keep in memory per track/car
LAP_POINTS_BUFFER_SIZE = 3000  # ~2.5 minutes at 20Hz, enough for any lap
MIN_LAP_POINTS = 100         # Minimum points required for a valid lap

# Session type mapping for LMU
# mSession values: 0=testday 1-4=practice 5-8=qual 9=warmup 10-13=race
SESSION_TYPE_MAP = {
    0: 'TestDay',
    1: 'Practice1', 2: 'Practice2', 3: 'Practice3', 4: 'Practice4',
    5: 'Qualify1', 6: 'Qualify2', 7: 'Qualify3', 8: 'Qualify4',
    9: 'Warmup',
    10: 'Race1', 11: 'Race2', 12: 'Race3', 13: 'Race4',
}

# Game phase names for human-readable output
# 0=Before session, 1=Recon, 2=Grid walk, 3=Formation, 4=Countdown, 5=Green, 6=FCY, 7=Stopped, 8=Over, 9=Paused
GAME_PHASE_NAMES = {
    0: 'before_session',
    1: 'reconnaissance',
    2: 'grid_walk',
    3: 'formation_lap',
    4: 'countdown',
    5: 'green_flag',
    6: 'full_course_yellow',
    7: 'session_stopped',
    8: 'session_over',
    9: 'paused',
}

# Track wetness mapping (LMU uses 0.0-1.0 scale)
TRACK_WETNESS_NAMES = {
    0: "dry",
    1: "mostly_dry",
    2: "very_lightly_wet",
    3: "lightly_wet",
    4: "moderately_wet",
    5: "very_wet",
    6: "extremely_wet",
}

# Finish status mapping
FINISH_STATUS_MAP = {
    0: 'Running',
    1: 'Finished',
    2: 'DNF',
    3: 'DQ',
}


# ============================================================================
# LAP TELEMETRY DATA STRUCTURES (COPIED FROM telemetry_service.py)
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
        
        # Pending lap waiting for time (LMU delay issue)
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

class LMUTelemetryService:
    """
    Minimal telemetry service that reads LMU data and forwards it.
    NO ANALYSIS - only data extraction and basic event detection.
    """

    def __init__(self):
        self.mmap_control: Optional[lmu_mmap.MMapControl] = None
        self.connected = False
        self.clients: set = set()
        
        # Previous frame state (for event detection)
        self.prev_lap: int = 0
        self.prev_game_phase: int = 0
        self.prev_yellow_state: int = -1
        self.prev_position: int = 0
        self.prev_in_pit: bool = False
        self.prev_session_num: int = -1
        
        # Session tracking for session_joined event
        self.current_session_id: int = -1
        self.session_joined_sent: bool = False
        
        # Minimal tracking for "helper" calculations
        self.fuel_used_history: deque = deque(maxlen=FUEL_HISTORY_SIZE)
        self.last_fuel_level: float = 0.0
        self.lap_start_fuel: float = 0.0
        
        # Timing
        self.last_snapshot_time: float = 0.0
        
        # 📊 LAP TELEMETRY CAPTURE
        self.lap_storage = LapStorageService(max_laps=MAX_STORED_LAPS)
        self.last_lap_capture_time: float = 0.0
        self.prev_lap_for_capture: int = 0

    def connect(self) -> bool:
        """Connect to LMU shared memory."""
        try:
            if self.mmap_control is None:
                self.mmap_control = lmu_mmap.MMapControl(
                    lmu_data.LMUConstants.LMU_SHARED_MEMORY_FILE,
                    lmu_data.LMUObjectOut
                )
                self.mmap_control.create(access_mode=0)  # Copy mode for safety
            
            # Test read to verify connection
            self.mmap_control.update()
            if self.mmap_control.data.generic.gameVersion > 0:
                self.connected = True
                logger.info("✅ Connected to Le Mans Ultimate")
                return True
            return False
        except Exception as e:
            logger.debug(f"Connection attempt failed: {e}")
            return False

    def disconnect(self):
        """Disconnect from LMU shared memory."""
        if self.mmap_control:
            try:
                self.mmap_control.close()
            except Exception as e:
                logger.error(f"Error closing mmap: {e}")
            self.mmap_control = None
        self.connected = False
        self._reset_state(preserve_laps=True)
        logger.info("❌ Disconnected from Le Mans Ultimate")

    def is_session_active(self) -> bool:
        """Check if we're in an active session (not in menu/garage)."""
        if not self.connected or not self.mmap_control:
            return False
        try:
            self.mmap_control.update()
            game_phase = self.mmap_control.data.scoring.scoringInfo.mGamePhase
            # Active phases: green flag (5), full course yellow (6)
            return game_phase in (5, 6)
        except Exception:
            return False

    def _reset_state(self, preserve_laps: bool = False):
        """Reset all tracking state.
        
        Args:
            preserve_laps: If True, don't clear lap storage (for temporary disconnects)
        """
        self.prev_lap = 0
        self.prev_game_phase = 0
        self.prev_yellow_state = -1
        self.prev_position = 0
        self.prev_in_pit = False
        self.prev_session_num = -1
        self.fuel_used_history.clear()
        self.last_fuel_level = 0.0
        self.lap_start_fuel = 0.0
        # Session tracking reset
        self.current_session_id = -1
        self.session_joined_sent = False
        # Lap capture reset - only clear if not preserving
        if not preserve_laps:
            self.lap_storage.reset_session()
        self.prev_lap_for_capture = 0

    def _map_session_type(self, session_num: int) -> str:
        """Map LMU session number to readable type."""
        return SESSION_TYPE_MAP.get(session_num, f'Session{session_num}')

    def _map_game_phase(self, phase: int) -> str:
        """Map LMU game phase to readable name."""
        return GAME_PHASE_NAMES.get(phase, 'unknown')

    def _get_lmu_flags(self, game_phase: int, yellow_state: int) -> List[str]:
        """Convert LMU game phase and yellow state to flag list."""
        flags = []
        
        if game_phase == 5:  # Green flag
            flags.append('green')
        elif game_phase == 6:  # Full course yellow
            flags.append('yellow')
            flags.append('caution')
            if yellow_state == 4:  # Pits open
                flags.append('caution_waving')
        elif game_phase == 7:  # Session stopped
            flags.append('red')
        elif game_phase == 8:  # Session over
            flags.append('checkered')
        
        return flags

    def _map_wetness(self, wetness: float) -> int:
        """Map LMU wetness (0.0-1.0) to iRacing-style integer (0-7)."""
        if wetness <= 0.0:
            return 0  # dry
        elif wetness <= 0.05:
            return 1  # mostly_dry
        elif wetness <= 0.15:
            return 2  # very_lightly_wet
        elif wetness <= 0.30:
            return 3  # lightly_wet
        elif wetness <= 0.50:
            return 4  # moderately_wet
        elif wetness <= 0.75:
            return 5  # very_wet
        else:
            return 6  # extremely_wet

    def _get_wetness_name(self, wetness: int) -> str:
        """Get wetness name from integer code."""
        return TRACK_WETNESS_NAMES.get(wetness, 'unknown')

    def _get_standings(self) -> List[Dict]:
        """Get full standings from scoring data."""
        standings = []
        try:
            scoring = self.mmap_control.data.scoring
            num_vehicles = scoring.scoringInfo.mNumVehicles
            
            for i in range(num_vehicles):
                veh = scoring.vehScoringInfo[i]
                
                # Skip if not active
                if veh.mPlace == 0:
                    continue
                
                standings.append({
                    'position': veh.mPlace,
                    'carIdx': veh.mID,
                    'carNumber': veh.mDriverName.decode('utf-8', errors='ignore').strip(),
                    'userName': veh.mDriverName.decode('utf-8', errors='ignore').strip(),
                    'carClass': veh.mVehicleClass.decode('utf-8', errors='ignore').strip(),
                    'carName': veh.mVehicleName.decode('utf-8', errors='ignore').strip(),
                    'lap': veh.mTotalLaps,
                    'lapsComplete': veh.mTotalLaps,
                    'bestLapTime': veh.mBestLapTime,
                    'lastLapTime': veh.mLastLapTime,
                    'timeBehindLeader': veh.mTimeBehindLeader,
                    'lapsBehindLeader': veh.mLapsBehindLeader,
                    'timeBehindNext': veh.mTimeBehindNext,
                    'inPits': veh.mInPits,
                    'pitStops': veh.mNumPitstops,
                    'reasonOutStr': self._get_finish_status(veh.mFinishStatus),
                })
            
            # Sort by position
            standings.sort(key=lambda x: x['position'])
            return standings
        except Exception as e:
            logger.debug(f"Error getting standings: {e}")
            return []

    def _get_finish_status(self, status: int) -> str:
        """Map finish status code to string."""
        return FINISH_STATUS_MAP.get(status, 'Running')

    def read_telemetry(self) -> Optional[Dict[str, Any]]:
        """
        Read all strategic telemetry data from LMU.
        Returns raw data structure ready to send.
        """
        if not self.connected or not self.mmap_control:
            return None

        try:
            # Update shared memory
            self.mmap_control.update()
            
            data = self.mmap_control.data
            scoring = data.scoring.scoringInfo
            telemetry = data.telemetry
            
            # Find player vehicle
            player_idx = telemetry.playerVehicleIdx
            if not telemetry.playerHasVehicle or player_idx >= telemetry.activeVehicles:
                return None
            
            player_telem = telemetry.telemInfo[player_idx]
            player_scoring = data.scoring.vehScoringInfo[player_idx]
            
            # === TIMING ===
            current_lap = player_telem.mLapNumber
            last_lap_time = player_scoring.mLastLapTime
            best_lap_time = player_scoring.mBestLapTime
            
            # Validate lap times - LMU uses 0 and -1 for "no data"
            # Convert invalid values to None so Gemini knows there's no data
            valid_last_lap = last_lap_time if last_lap_time > 0 else None
            valid_best_lap = best_lap_time if best_lap_time > 0 else None
            
            # Log when we filter invalid values (helps debugging)
            if last_lap_time <= 0 and current_lap > 1:
                logger.debug(f"⚠️ Invalid lastLapTime filtered: {last_lap_time} (lap {current_lap})")
            if best_lap_time <= 0 and current_lap > 1:
                logger.debug(f"⚠️ Invalid bestLapTime filtered: {best_lap_time} (lap {current_lap})")
            
            # Calculate lap distance percentage
            lap_dist = player_scoring.mLapDist
            track_length = scoring.mLapDist
            lap_dist_pct = lap_dist / track_length if track_length > 0 else 0.0
            
            # Current lap time (estimated)
            current_lap_time = player_scoring.mTimeIntoLap
            
            # Delta to best (from LMU's mDeltaBest)
            delta_to_best = player_telem.mDeltaBest
            
            # === SECTORS ===
            # LMU sectors: 0=sector3, 1=sector1, 2=sector2 (quirky!)
            lmu_sector = player_scoring.mSector
            if lmu_sector == 1:
                current_sector = 1  # sector1
            elif lmu_sector == 2:
                current_sector = 2  # sector2
            else:  # 0 or anything else
                current_sector = 3  # sector3
            
            # === POSITION ===
            position = player_scoring.mPlace
            total_cars = scoring.mNumVehicles
            
            # === GAPS ===
            gap_ahead = player_scoring.mTimeBehindNext if player_scoring.mTimeBehindNext >= 0 else 0.0
            gap_behind = 0.0  # Calculate from car behind
            gap_to_leader = player_scoring.mTimeBehindLeader if player_scoring.mTimeBehindLeader >= 0 else 0.0
            
            # Find car behind
            for i in range(total_cars):
                veh = data.scoring.vehScoringInfo[i]
                if veh.mPlace == position + 1:
                    gap_behind = veh.mTimeBehindNext
                    break
            
            # === FUEL ===
            fuel_level = player_telem.mFuel
            fuel_capacity = player_telem.mFuelCapacity
            fuel_pct = (fuel_level / fuel_capacity * 100) if fuel_capacity > 0 else 0
            
            # Track fuel used per lap
            fuel_used_last_lap = 0.0
            if current_lap > self.prev_lap and self.lap_start_fuel > 0:
                fuel_used_last_lap = self.lap_start_fuel - fuel_level
                if fuel_used_last_lap > 0:
                    self.fuel_used_history.append(fuel_used_last_lap)
                self.lap_start_fuel = fuel_level
            elif self.lap_start_fuel == 0:
                self.lap_start_fuel = fuel_level

            fuel_per_lap_avg = 0.0
            if self.fuel_used_history:
                fuel_per_lap_avg = sum(self.fuel_used_history) / len(self.fuel_used_history)
            
            # Estimate laps remaining based on fuel
            estimated_laps_remaining = 0.0
            if fuel_per_lap_avg > 0:
                estimated_laps_remaining = fuel_level / fuel_per_lap_avg

            # === PIT INFO ===
            on_pit_road = player_scoring.mInPits
            pit_state = player_scoring.mPitState  # 0=none, 1=request, 2=entering, 3=stopped, 4=exiting
            in_pit_stall = pit_state == 3
            
            # === SESSION ===
            session_num = scoring.mSession
            session_type = self._map_session_type(session_num)
            game_phase = scoring.mGamePhase
            session_state = self._map_game_phase(game_phase)
            
            session_time_remain = scoring.mEndET - scoring.mCurrentET
            max_laps = scoring.mMaxLaps
            
            # Track info
            track_name = scoring.mTrackName.decode('utf-8', errors='ignore').strip()
            car_name = player_telem.mVehicleName.decode('utf-8', errors='ignore').strip()
            
            # === TRACK CONDITIONS ===
            track_temp = scoring.mTrackTemp
            air_temp = scoring.mAmbientTemp
            avg_wetness_float = scoring.mAvgPathWetness
            track_wetness = self._map_wetness(avg_wetness_float)
            raining = scoring.mRaining
            
            # === FLAGS ===
            yellow_state = ord(scoring.mYellowFlagState) if isinstance(scoring.mYellowFlagState, bytes) else scoring.mYellowFlagState
            flag_list = self._get_lmu_flags(game_phase, yellow_state)
            
            # === STANDINGS ===
            standings = self._get_standings()
            
            # Build telemetry object
            telemetry_out = {
                'timestamp': int(time.time() * 1000),
                'simulator': 'LMU',
                
                # Timing
                'timing': {
                    'currentLap': current_lap,
                    'lapsCompleted': current_lap - 1,
                    'lapDistPct': round(lap_dist_pct, 4),
                    'currentLapTime': round(current_lap_time, 3),
                    'lastLapTime': round(valid_last_lap, 3) if valid_last_lap else None,
                    'bestLapTime': round(valid_best_lap, 3) if valid_best_lap else None,
                    'deltaToBest': round(delta_to_best, 3) if delta_to_best != 0 else None,
                    'deltaToSessionBest': None,  # LMU doesn't provide this
                    'currentSector': current_sector,
                },
                
                # Position
                'position': {
                    'overall': position,
                    'class': position,  # LMU doesn't separate class position easily
                    'totalCars': total_cars,
                },
                
                # Gaps
                'gaps': {
                    'ahead': round(gap_ahead, 3),
                    'behind': round(gap_behind, 3),
                    'toLeader': round(gap_to_leader, 3),
                },
                
                # Fuel
                'fuel': {
                    'level': round(fuel_level, 2),
                    'pct': round(fuel_pct, 1),
                    'usedLastLap': round(fuel_used_last_lap, 3),
                    'perLapAvg': round(fuel_per_lap_avg, 3),
                    'estimatedLapsRemaining': round(estimated_laps_remaining, 1),
                    'maxLtr': round(fuel_capacity, 1),
                },
                
                # Pit
                'pit': {
                    'inPitLane': on_pit_road,
                    'inPitStall': in_pit_stall,
                    'pitsOpen': yellow_state in (3, 4),  # Pit lead lap or pits open
                    'pitLimiterOn': player_telem.mSpeedLimiter > 0,
                    'repairTimeLeft': 0,  # LMU doesn't expose this
                    'optRepairTimeLeft': 0,
                    'fastRepairAvailable': 0,
                    'fastRepairUsed': 0,
                },
                
                # Session
                'session': {
                    'type': session_type,
                    'name': session_type,
                    'state': session_state,
                    'stateRaw': game_phase,
                    'timeRemaining': round(session_time_remain, 1) if session_time_remain > 0 else 0,
                    'lapsRemaining': max_laps - current_lap if max_laps > 0 else 0,
                    'lapsTotal': max_laps,
                    'raceLaps': max_laps if session_num >= 10 else 0,
                    'trackName': track_name,
                    'trackConfig': '',
                    'trackLength': f'{track_length/1000:.2f} km',
                    'carName': car_name,
                    'estLapTime': round(player_scoring.mEstimatedLapTime, 3),
                    'trackRubberState': '',
                    'numLeadChanges': 0,
                    'numCautionFlags': 0,
                    'numCautionLaps': 0,
                },
                
                # Track conditions
                'track': {
                    'tempCelsius': round(track_temp, 1),
                    'airTempCelsius': round(air_temp, 1),
                    'wetness': track_wetness,
                    'wetnessName': self._get_wetness_name(track_wetness),
                    'skies': 0,  # LMU doesn't expose this
                    'weatherDeclaredWet': raining > 0.5,
                },
                
                # Flags
                'flags': {
                    'active': flag_list,
                    'raw': game_phase,
                },
                
                # Incidents (LMU doesn't track this like iRacing)
                'incidents': {
                    'count': 0,
                    'teamCount': 0,
                    'limit': 0,
                },
                
                # Tires (LMU tiene datos completos de temperatura y desgaste)
                'tires': {
                    'setsAvailable': 255,
                    'setsUsed': 0,
                    'compound': player_telem.mFrontTireCompoundName.decode('utf-8', errors='ignore').strip(),
                    # Datos por rueda: FL, FR, RL, RR
                    'temps': {
                        'FL': {
                            'left': round(player_telem.mWheels[0].mTemperature[0], 1),
                            'center': round(player_telem.mWheels[0].mTemperature[1], 1),
                            'right': round(player_telem.mWheels[0].mTemperature[2], 1),
                            'avg': round(sum(player_telem.mWheels[0].mTemperature) / 3, 1),
                        },
                        'FR': {
                            'left': round(player_telem.mWheels[1].mTemperature[0], 1),
                            'center': round(player_telem.mWheels[1].mTemperature[1], 1),
                            'right': round(player_telem.mWheels[1].mTemperature[2], 1),
                            'avg': round(sum(player_telem.mWheels[1].mTemperature) / 3, 1),
                        },
                        'RL': {
                            'left': round(player_telem.mWheels[2].mTemperature[0], 1),
                            'center': round(player_telem.mWheels[2].mTemperature[1], 1),
                            'right': round(player_telem.mWheels[2].mTemperature[2], 1),
                            'avg': round(sum(player_telem.mWheels[2].mTemperature) / 3, 1),
                        },
                        'RR': {
                            'left': round(player_telem.mWheels[3].mTemperature[0], 1),
                            'center': round(player_telem.mWheels[3].mTemperature[1], 1),
                            'right': round(player_telem.mWheels[3].mTemperature[2], 1),
                            'avg': round(sum(player_telem.mWheels[3].mTemperature) / 3, 1),
                        },
                    },
                    'wear': {
                        'FL': round((1.0 - player_telem.mWheels[0].mWear) * 100, 1),  # Convertir a porcentaje
                        'FR': round((1.0 - player_telem.mWheels[1].mWear) * 100, 1),
                        'RL': round((1.0 - player_telem.mWheels[2].mWear) * 100, 1),
                        'RR': round((1.0 - player_telem.mWheels[3].mWear) * 100, 1),
                    },
                    'pressure': {
                        'FL': round(player_telem.mWheels[0].mPressure, 2),
                        'FR': round(player_telem.mWheels[1].mPressure, 2),
                        'RL': round(player_telem.mWheels[2].mPressure, 2),
                        'RR': round(player_telem.mWheels[3].mPressure, 2),
                    },
                },
                
                # Full standings
                'standings': standings,
                
                # Setup básico (LMU tiene datos limitados en memoria compartida)
                'setup': {
                    'brakeBias': round(player_telem.mRearBrakeBias * 100, 1),  # Convertir a porcentaje
                    'fuelCapacity': round(player_telem.mFuelCapacity, 1),
                    'maxGears': player_telem.mMaxGears,
                    'engineMaxRPM': round(player_telem.mEngineMaxRPM, 0),
                },
            }

            # Update tracking for next frame
            self.prev_lap = current_lap
            self.prev_game_phase = game_phase
            self.prev_yellow_state = yellow_state
            self.prev_position = position
            self.prev_in_pit = on_pit_road
            self.prev_session_num = session_num
            self.last_fuel_level = fuel_level

            return telemetry_out

        except Exception as e:
            logger.error(f"Error reading telemetry: {e}")
            return None

    def capture_lap_telemetry(self) -> Optional[LapData]:
        """
        Capture high-frequency telemetry data for lap comparison graphs.
        Called at 20Hz. Returns completed LapData when a lap finishes.
        """
        if not self.connected or not self.mmap_control:
            return None
        
        try:
            # Check timing
            now = time.time()
            if now - self.last_lap_capture_time < LAP_CAPTURE_INTERVAL:
                return None
            self.last_lap_capture_time = now
            
            # Update data
            self.mmap_control.update()
            data = self.mmap_control.data
            telemetry = data.telemetry
            
            player_idx = telemetry.playerVehicleIdx
            if not telemetry.playerHasVehicle or player_idx >= telemetry.activeVehicles:
                return None
            
            player_telem = telemetry.telemInfo[player_idx]
            player_scoring = data.scoring.vehScoringInfo[player_idx]
            
            current_lap = player_telem.mLapNumber
            last_lap_time = player_scoring.mLastLapTime
            
            # Calculate lap distance percentage
            lap_dist = player_scoring.mLapDist
            track_length = data.scoring.scoringInfo.mLapDist
            lap_dist_pct = lap_dist / track_length if track_length > 0 else 0.0
            
            # ========================================
            # CHECK FOR PENDING LAP WAITING FOR TIME
            # ========================================
            if len(self.lap_storage.pending_lap_points) > 0:
                pending_age = now - self.lap_storage.pending_lap_created_at
                if pending_age > 10.0:
                    logger.warning(f"⏰ Pending lap timed out after {pending_age:.1f}s - clearing")
                    self.lap_storage.clear_pending_lap()
                elif last_lap_time > 0:
                    logger.info(f"📊 Pending lap now has valid time: {last_lap_time:.3f}s - saving!")
                    completed_lap = self.lap_storage.save_pending_lap(last_lap_time)
                    if completed_lap:
                        return completed_lap
            
            # Detect lap change
            if current_lap > self.prev_lap_for_capture and self.prev_lap_for_capture > 0:
                logger.info(f"🏁 LAP CHANGE DETECTED: {self.prev_lap_for_capture} -> {current_lap}")
                
                prev_lap = self.prev_lap_for_capture
                self.prev_lap_for_capture = current_lap
                
                # Get track and car names
                track_name = data.scoring.scoringInfo.mTrackName.decode('utf-8', errors='ignore').strip()
                car_name = player_telem.mVehicleName.decode('utf-8', errors='ignore').strip()
                
                completed_lap = None
                if last_lap_time > 0:
                    completed_lap = self.lap_storage.complete_lap(
                        lap_time=last_lap_time,
                        track_name=track_name,
                        car_name=car_name
                    )
                else:
                    # Store as pending
                    logger.warning(f"⚠️ Lap time not available - storing as PENDING")
                    if len(self.lap_storage.current_lap_points) > MIN_LAP_POINTS:
                        self.lap_storage.pending_lap_points = self.lap_storage.current_lap_points.copy()
                        self.lap_storage.pending_lap_number = prev_lap
                        self.lap_storage.pending_lap_track = track_name
                        self.lap_storage.pending_lap_car = car_name
                        self.lap_storage.pending_lap_created_at = now
                
                # Start new lap
                self.lap_storage.start_lap(current_lap)
                return completed_lap
            
            # First lap detection
            if current_lap > 0 and self.prev_lap_for_capture == 0:
                logger.info(f"🚀 FIRST LAP DETECTED: Starting capture for lap {current_lap}")
                self.lap_storage.start_lap(current_lap)
                self.prev_lap_for_capture = current_lap
            
            # Only capture when not in pits
            if player_scoring.mInPits:
                return None
            
            # Capture telemetry point
            if self.lap_storage.recording_active:
                # Calculate speed in km/h
                speed_ms = (player_telem.mLocalVel.x**2 + player_telem.mLocalVel.y**2 + player_telem.mLocalVel.z**2)**0.5
                speed_kmh = speed_ms * 3.6
                
                point = TelemetryPoint(
                    distancePct=round(lap_dist_pct, 4),
                    speed=round(speed_kmh, 1),
                    throttle=round(player_telem.mUnfilteredThrottle, 3),
                    brake=round(player_telem.mUnfilteredBrake, 3),
                    gear=int(player_telem.mGear),
                    rpm=round(player_telem.mEngineRPM, 0),
                    steeringAngle=round(player_telem.mUnfilteredSteering, 4)
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
        events = []
        
        if not telemetry:
            return events

        current_lap = telemetry['timing']['currentLap']
        current_game_phase = telemetry['flags']['raw']
        current_position = telemetry['position']['overall']
        current_in_pit = telemetry['pit']['inPitLane']
        session_num = self.prev_session_num
        
        # 🎯 SESSION JOINED
        if session_num != self.current_session_id or not self.session_joined_sent:
            self.current_session_id = session_num
            self.session_joined_sent = True
            
            standings = telemetry.get('standings', [])
            
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
                    'weatherDeclaredWet': telemetry['track'].get('weatherDeclaredWet', False),
                    'trackTemp': telemetry['track'].get('tempCelsius', 0),
                    'airTemp': telemetry['track'].get('airTempCelsius', 0),
                    'standings': standings,
                    'playerPosition': current_position,
                }
            })
            logger.info(f"📋 SESSION JOINED: {len(standings)} drivers")

        # Lap completed
        if current_lap > self.prev_lap and self.prev_lap > 0:
            events.append({
                'type': 'lap_complete',
                'data': {
                    'lap': current_lap - 1,
                    'lapTime': telemetry['timing']['lastLapTime'],
                    'delta': telemetry['timing'].get('deltaToBest'),
                    'position': current_position,
                    'fuelUsed': telemetry['fuel']['usedLastLap'],
                }
            })

        # Flag/phase change
        if current_game_phase != self.prev_game_phase:
            events.append({
                'type': 'flag_change',
                'data': {
                    'flags': telemetry['flags']['active'],
                    'previousRaw': self.prev_game_phase,
                    'currentRaw': current_game_phase,
                }
            })

        # Position change
        if current_position != self.prev_position and self.prev_position > 0:
            change = self.prev_position - current_position
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

        return events


# ============================================================================
# WEBSOCKET SERVER
# ============================================================================

class TelemetryWebSocketServer:
    """WebSocket server that broadcasts telemetry to connected clients."""

    def __init__(self, telemetry_service: LMUTelemetryService):
        self.telemetry = telemetry_service
        self.clients: set = set()
        self.last_snapshot: Optional[Dict] = None

    async def register(self, websocket):
        """Register a new client."""
        self.clients.add(websocket)
        logger.info(f"📡 Client connected. Total: {len(self.clients)}")
        
        # Send last snapshot to new client
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
                # LMU doesn't support commands yet, but keep handler for future
                pass
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            await self.unregister(websocket)


# ============================================================================
# MAIN LOOP
# ============================================================================

async def telemetry_loop(telemetry: LMUTelemetryService, server: TelemetryWebSocketServer):
    """Main telemetry reading and broadcasting loop (1Hz for strategic data)."""
    
    while True:
        # Try to connect to LMU if not connected
        if not telemetry.connected:
            if telemetry.connect():
                logger.info("🏎️  Le Mans Ultimate connection established")
            else:
                logger.debug("Waiting for Le Mans Ultimate...")
                await asyncio.sleep(RECONNECT_DELAY)
                continue

        # Read telemetry
        data = telemetry.read_telemetry()
        
        if data:
            current_time = time.time()
            session_active = telemetry.is_session_active()
            
            # Detect events
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

            # Send snapshot at interval
            if current_time - telemetry.last_snapshot_time >= SNAPSHOT_INTERVAL:
                snapshot = {
                    'type': 'snapshot',
                    'timestamp': int(current_time * 1000),
                    'data': data,
                }
                server.last_snapshot = snapshot
                await server.broadcast(snapshot)
                telemetry.last_snapshot_time = current_time
                logger.info(f"📊 Snapshot sent to {len(server.clients)} clients")

        await asyncio.sleep(POLL_INTERVAL)


async def lap_capture_loop(telemetry: LMUTelemetryService, server: TelemetryWebSocketServer):
    """High-frequency lap telemetry capture loop (20Hz)."""
    
    while True:
        if not telemetry.connected:
            await asyncio.sleep(0.5)
            continue
        
        # Capture telemetry point and check for completed lap
        completed_lap = telemetry.capture_lap_telemetry()
        
        # If a lap was completed, broadcast the event AND full data
        if completed_lap:
            # Event notification
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
            
            # Full lap data with all telemetry points
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
                    'points': completed_lap.points,
                    'deltaToSessionBest': completed_lap.deltaToSessionBest
                }
            }
            await server.broadcast(lap_data_msg)
            
            logger.info(f"📊 Lap {completed_lap.lapNumber} sent: {completed_lap.lapTime:.3f}s")
        
        await asyncio.sleep(LAP_CAPTURE_INTERVAL)


async def main():
    """Main entry point."""
    logger.info("=" * 50)
    logger.info("Le Mans Ultimate Telemetry Service")
    logger.info("=" * 50)
    logger.info(f"WebSocket port: {WEBSOCKET_PORT}")
    logger.info(f"Snapshot interval: {SNAPSHOT_INTERVAL}s")
    logger.info(f"Poll interval: {POLL_INTERVAL}s")
    logger.info(f"Lap capture interval: {LAP_CAPTURE_INTERVAL}s (20Hz)")
    logger.info(f"Max stored laps: {MAX_STORED_LAPS}")
    logger.info("=" * 50)

    # Create services
    telemetry = LMUTelemetryService()
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
