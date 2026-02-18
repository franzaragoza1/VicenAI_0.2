/**
 * Race Snapshot Types
 * Types for race state snapshots used by Gemini
 */

/**
 * Attention/urgency info for race updates
 */
export interface AttentionInfo {
  type: string;
  urgency: 'low' | 'medium' | 'high' | 'critical';
  reason: string;
}

/**
 * Sector timing data
 */
export interface SectorTiming {
  sector1?: number;
  sector2?: number;
  sector3?: number;
  s1Ms?: number;
  s2Ms?: number;
  s3Ms?: number;
  s1DeltaMs?: number;
  s2DeltaMs?: number;
  s3DeltaMs?: number;
}

/**
 * Timing data in a race snapshot
 */
export interface SnapshotTiming {
  currentLap: number;
  totalLaps?: number;
  lastLapMs: number;
  lapValidity: string;
  deltaToPersonalBestMs: number;
  sectors: SectorTiming;
}

/**
 * Opponent info in position data
 */
export interface PositionOpponent {
  name: string;
  gap: number;
  gapMs?: number;
  gapTrend?: 'CLOSING' | 'OPENING' | 'STABLE';
  iRating?: number;
}

/**
 * Position data in a race snapshot
 */
export interface SnapshotPosition {
  current: number;
  total: number;
  classPosition?: number;
  ahead?: PositionOpponent;
  behind?: PositionOpponent;
}

/**
 * Vehicle state in a race snapshot
 */
export interface SnapshotVehicle {
  hasDamage: boolean;
  damageLevel?: string;
  fuelLapsRemaining?: number;
  fuelLevel?: number;
  tireWear?: number;
}

/**
 * Session info in a race snapshot
 */
export interface SnapshotSession {
  type: string;
  flags: string;
  trackName?: string;
  carName?: string;
  timeRemaining?: number;
}

/**
 * Lap data in a race snapshot
 */
export interface SnapshotLap {
  lapNumber: number;
  lapTime: number;
  lapTimeMs?: number;
  wasValid?: boolean;
  sector1?: number;
  sector2?: number;
  sector3?: number;
  fuelUsed?: number;
  position?: number;
}

/**
 * Race snapshot for Gemini analysis
 */
export interface RaceSnapshot {
  timestamp: number;
  attention: AttentionInfo;
  timing: SnapshotTiming;
  position: SnapshotPosition;
  vehicle: SnapshotVehicle;
  session: SnapshotSession;
  recentLaps: SnapshotLap[];
  
  // Legacy/alternative fields
  sessionType?: string;
  trackName?: string;
  carName?: string;
  currentLap?: number;
  lapsCompleted?: number;
  lapsRemaining?: number;
  timeRemaining?: number;
  gapAhead?: number;
  gapBehind?: number;
  gapToLeader?: number;
  lastLapTime?: number;
  bestLapTime?: number;
  fuelLevel?: number;
  fuelLapsRemaining?: number;
  totalCars?: number;
  flags?: string[];
  inPit?: boolean;
  pitStops?: number;
}
