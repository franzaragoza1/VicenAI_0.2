/**
 * Telemetry Types for iRacing Native Integration
 * ================================================
 * 
 * RAW DATA TYPES - No analysis, just structure
 * Gemini receives these and performs all strategic analysis
 */

// ============================================================================
// MAIN TELEMETRY DATA (from Python service)
// ============================================================================

/**
 * Complete telemetry snapshot from iRacing
 * All values are RAW - no interpretation or analysis
 */
export interface TelemetryData {
  timestamp: number;
  simulator: 'iRacing';

  // === TIMING ===
  timing: TimingData;

  // === POSITION ===
  position: PositionData;

  // === GAPS (raw seconds) ===
  gaps: GapsData;

  // === FUEL (raw values) ===
  fuel: FuelData;

  // === PIT INFO ===
  pit: PitData;

  // === SESSION ===
  session: SessionData;

  // === TRACK CONDITIONS ===
  track: TrackData;

  // === FLAGS ===
  flags: FlagsData;

  // === INCIDENTS ===
  incidents: IncidentData;

  // === TIRES ===
  tires: TireData;

  // === STANDINGS (Full race standings) ===
  standings: StandingEntry[];
}

/**
 * Timing information
 */
export interface TimingData {
  /** Current lap number */
  currentLap: number;
  /** Completed laps count */
  lapsCompleted: number;
  /** Progress through current lap (0.0 - 1.0) */
  lapDistPct: number;
  /** Current lap elapsed time in seconds */
  currentLapTime: number;
  /** Last completed lap time in seconds */
  lastLapTime: number;
  /** Personal best lap time in seconds */
  bestLapTime: number;
  /** Live delta to personal best (from iRacing, null if not valid) */
  deltaToBest: number | null;
  /** Live delta to session best (from iRacing, null if not valid) */
  deltaToSessionBest: number | null;
  /** Current sector index (1=Sector1, 2=Sector2, 3=Sector3) - Estimated */
  currentSector: number;
}

/**
 * Position information
 */
export interface PositionData {
  /** Overall race position */
  overall: number;
  /** Class position (for multiclass) */
  class: number;
  /** Total cars in session */
  totalCars: number;
}

/**
 * Gap information (all in seconds)
 */
export interface GapsData {
  /** Gap to car ahead in seconds (positive = behind) */
  ahead: number;
  /** Gap to car behind in seconds (positive = they're behind) */
  behind: number;
  /** Gap to race leader in seconds */
  toLeader: number;
  /** Alias for ahead - Gap to car ahead in seconds */
  toCarAhead?: number;
  /** Alias for behind - Gap to car behind in seconds */
  toCarBehind?: number;
}

/**
 * Fuel information
 */
export interface FuelData {
  /** Current fuel level in liters */
  level: number;
  /** Fuel percentage (0-100) */
  pct: number;
  /** Fuel used last lap in liters */
  usedLastLap: number;
  /** Average fuel per lap (simple avg of last laps) */
  perLapAvg: number;
  /** Estimated laps remaining based on consumption */
  estimatedLapsRemaining: number;
  /** Maximum fuel capacity in liters */
  maxLtr: number;
  /** Alias for estimatedLapsRemaining */
  lapsRemaining?: number;
  /** Alias for maxLtr - fuel tank capacity */
  capacity?: number;
}

/**
 * Pit information
 */
export interface PitData {
  /** Currently in pit lane */
  inPitLane: boolean;
  /** In pit stall (stopped in box) */
  inPitStall: boolean;
  /** Are pits open? */
  pitsOpen: boolean;
  /** Pit speed limiter active */
  pitLimiterOn: boolean;
  /** Required repair time remaining (seconds) */
  repairTimeLeft: number;
  /** Optional repair time remaining (seconds) */
  optRepairTimeLeft: number;
  /** Fast repairs available */
  fastRepairAvailable: number;
  /** Fast repairs used */
  fastRepairUsed: number;
}

/**
 * Session information
 */
export interface SessionData {
  /** Session type: "Race", "Practice", "Qualifying", etc. */
  type: string;
  /** Session name from iRacing */
  name: string;
  /** Human-readable session state */
  state: 'invalid' | 'get_in_car' | 'warmup' | 'parade_laps' | 'racing' | 'checkered' | 'cool_down' | 'unknown';
  /** Raw session state value */
  stateRaw: number;
  /** Session time of day (e.g., "14:30", "16:45") - hora en simulador */
  sessionTime: string;
  /** Time remaining in seconds (0 if unlimited) */
  timeRemaining: number;
  /** Laps remaining (0 if unlimited/timed) */
  lapsRemaining: number;
  /** Total laps in race (0 if timed) */
  lapsTotal: number;
  /** Current race laps completed by leader */
  raceLaps: number;
  /** Track name */
  trackName: string;
  /** Track configuration name */
  trackConfig: string;
  /** Track length string (e.g., "2.50 mi") */
  trackLength: string;
  /** Car name */
  carName: string;
  /** Estimated lap time (from DriverInfo) */
  estLapTime: number;
  /** Track rubber state */
  trackRubberState: string;
  /** Number of lead changes */
  numLeadChanges: number;
  /** Number of caution flags */
  numCautionFlags: number;
  /** Number of caution laps */
  numCautionLaps: number;
}

/**
 * Track conditions
 */
export interface TrackData {
  /** Track surface temperature in Celsius */
  tempCelsius: number;
  /** Air temperature in Celsius */
  airTempCelsius: number;
  /** Track wetness level (0 = dry) */
  wetness: number;
  /** Sky condition (0=clear, 1=partly cloudy, 2=mostly cloudy, 3=overcast) */
  skies: number;
  /** Whether race declared wet */
  weatherDeclaredWet: boolean;
}

/**
 * Flags information
 */
export interface FlagsData {
  /** List of active flag names */
  active: string[];
  /** Raw flag bitfield */
  raw: number;
}

/**
 * Incident information
 */
export interface IncidentData {
  /** Current personal incident count */
  count: number;
  /** Alias for count - Current personal incident count */
  incidentCount?: number;
  /** Team incident count */
  teamCount: number;
  /** Session incident limit (0 if unlimited) */
  limit: number;
}

/**
 * Tire information
 */
export interface TireData {
  /** Tire sets available */
  setsAvailable: number;
  /** Tire sets used */
  setsUsed: number;
  /** Current tire compound (0=dry, 1=wet) */
  compound: number;
}

/**
 * Standing entry from ResultsPositions
 */
export interface StandingEntry {
  /** Overall position */
  position: number;
  /** Car index */
  carIdx: number;
  /** Car number */
  carNumber: string;
  /** Driver name */
  userName: string;
  /** Alias for userName - Driver name */
  name?: string;
  /** Driver iRating */
  iRating: number;
  /** Driver license/safety rating (e.g., "A 4.12") */
  license: string;
  /** Car class name */
  carClass: string;
  /** Class position */
  classPosition: number;
  /** Current lap */
  lap: number;
  /** Completed laps */
  lapsComplete: number;
  /** Fastest lap time */
  fastestTime: number;
  /** Last lap time */
  lastTime: number;
  /** Incident count */
  incidents: number;
  /** Reason out (if DNF/DQ) */
  reasonOutStr: string;
  /** Gap to leader in seconds */
  gapToLeader?: number;
  /** Sector 1 time (virtual sector, calculated) */
  s1?: number | null;
  /** Sector 2 time (virtual sector, calculated) */
  s2?: number | null;
  /** Sector 3 time (virtual sector, calculated) */
  s3?: number | null;
}

// ============================================================================
// EVENTS
// ============================================================================

export type TelemetryEventType =
  | 'lap_complete'
  | 'flag_change'
  | 'position_change'
  | 'pit_entry'
  | 'pit_exit'
  | 'incident'
  | 'session_state_change'
  | 'session_joined'  // 📋 Full participant table sent when joining session
  | 'spotter';  // 🔊 Proximity spotter (car_left, car_right, clear, etc.)

export interface TelemetryEvent {
  type: TelemetryEventType;
  data: Record<string, unknown>;
}

export interface LapCompleteEvent {
  type: 'lap_complete';
  data: {
    lap: number;
    lapTime: number;
    delta: number | null;
    position: number;
    fuelUsed: number;
  };
}

export interface FlagChangeEvent {
  type: 'flag_change';
  data: {
    flags: string[];
    previousRaw: number;
    currentRaw: number;
  };
}

export interface PositionChangeEvent {
  type: 'position_change';
  data: {
    from: number;
    to: number;
    change: number;
    gapAhead: number;
    gapBehind: number;
  };
}

export interface PitEvent {
  type: 'pit_entry' | 'pit_exit';
  data: {
    fuelLevel: number;
    inPitStall: boolean;
  };
}

export interface IncidentEvent {
  type: 'incident';
  data: {
    count: number;
    limit: number;
    added: number;
  };
}

export interface SessionStateChangeEvent {
  type: 'session_state_change';
  data: {
    from: string;
    to: string;
  };
}

// ============================================================================
// MESSAGE TYPES (WebSocket protocol)
// ============================================================================

export interface TelemetrySnapshot {
  type: 'snapshot';
  timestamp: number;
  data: TelemetryData;
}

export interface TelemetryEventMessage {
  type: 'event';
  timestamp: number;
  event: TelemetryEvent;
  data: TelemetryData;
}

export type TelemetryMessage = TelemetrySnapshot | TelemetryEventMessage;

// ============================================================================
// CONTEXT TYPES (for Gemini tools)
// ============================================================================

/**
 * Session context for Gemini's get_session_context tool
 * Maps raw telemetry to a format Gemini can use - COMPLETE data
 */
export interface SessionContext {
  timing: {
    lastLapTime: number | null; // Segundos (ej: 133.221) - null si no hay datos válidos
    bestLapTime: number | null; // Segundos (ej: 92.456) - null si no hay datos válidos
    deltaToBest: number | null; // Segundos (ej: 0.8, -1.2)
    deltaToSessionBest: number | null;
    currentLap: number;
    lapsCompleted: number;
    lapDistPct: number;
    currentLapTime?: number;
    deltaToBestRaw?: number | null;
    deltaToSessionBestRaw?: number | null;
  };
  race: {
    position: number;
    classPosition: number;
    totalCars: number;
    gapAhead: number | null;     // Segundos (ej: 2.5, null si no hay)
    gapBehind: number | null;    // Segundos (ej: 1.2)
    gapToLeader: number | null;  // Segundos (ej: 15.8)
  };
  session: {
    trackName: string;
    trackConfig: string;
    trackLength: string;
    carName: string;
    type: string;
    name: string;
    state: string;
    sessionTime: string;         // Hora en simulador (ej: "14:30", "16:45")
    timeRemaining: number;
    lapsRemaining: number;
    lapsTotal: number;
    raceLaps: number;
    estLapTime: number;
    lapsRemainingRaw?: number;
    lapsTotalRaw?: number;
    lapsRemainingEstimated?: number | null;
    timeRemainingMinutes?: number | null;
    trackRubberState?: string;
    numLeadChanges: number;
    numCautionFlags: number;
    numCautionLaps: number;
    flags: {
      yellow: boolean;
      blue: boolean;
      white: boolean;
      checkered: boolean;
      active: string[];
    };
  };
  fuel: {
    level: number;
    pct: number;
    usedLastLap: number;
    perLapAvg: number;
    maxLtr: number;
    estimatedLapsRemaining: number;
    estimatedLapsRemainingFromAvg?: number | null;
  };
  pit: {
    inPitLane: boolean;
    inPitStall: boolean;
    pitsOpen: boolean;
    pitLimiterOn: boolean;
    repairTimeLeft: number;
    optRepairTimeLeft: number;
    fastRepairAvailable: number;
    fastRepairUsed: number;
  };
  track: {
    tempCelsius: number;
    airTempCelsius: number;
    wetness: number;
    skies: number;
    weatherDeclaredWet: boolean;
  };
  incidents: {
    count: number;
    teamCount: number;
    limit: number;
  };
  tires: {
    setsAvailable: number;
    setsUsed: number;
    compound: number;
  };
  /** TABLA COMPLETA de clasificación con TODOS los rivales - ordenada por posición */
  standings: StandingEntry[];
  /** Contexto de clase en sesiones multiclase (opcional) */
  classContext?: {
    className: string;
    classPosition: number;
    classTotalCars: number;
    classLeader?: {
      name: string;
      carNumber: string;
      iRating: number;
      license: string;
      fastestTime: number;
    };
    standingsInClass: StandingEntry[];
  };
}

/**
 * Opponent info for competition context
 */
export interface OpponentInfo {
  name?: string;
  iRating?: number;
  license?: string;
  gap?: number;
  gapFormatted?: string;
}

/**
 * Damage info for competition context
 */
export interface DamageInfo {
  severity: 'none' | 'light' | 'moderate' | 'heavy';
  message?: string;
}

/**
 * Competition context for strategic analysis
 * Gemini uses this to make decisions (fuel, gaps, etc.)
 */
export interface CompetitionContext {
  timing: {
    lastLapTime: number;
    deltaToSessionBest: number;
  };
  race: {
    position: number;
    gapAhead: number;
    gapBehind: number;
    opponentAhead?: OpponentInfo;
    opponentBehind?: OpponentInfo;
  };
  session: {
    flags: {
      yellow: boolean;
      blue: boolean;
    };
  };
  situation: {
    isBeingPressured: boolean;
    isHeldUp: boolean;
    pressureGap?: number;
    heldUpGap?: number;
  };
  strategy: {
    fuelLapsRemaining: number;
  };
  damage?: DamageInfo;
}

/**
 * Full telemetry for Gemini tools
 */
export interface FullTelemetry extends Partial<TelemetryData> {
  [key: string]: unknown;
}

// ============================================================================
// SIMHUB TELEMETRY TYPES (Rich data from SimHub UDP)
// ============================================================================

/**
 * SimHub opponent info
 */
export interface SimHubOpponentInfo {
  name: string;
  carNumber: string;
  carName: string;
  className: string;
  iRating: number;
  license: string;
  safetyRating: string;
  gap: number;
  lastLapTime: number;
  positionInClass: string;
  isInPit: boolean;
  tireCompound: string;
  isRelevant: boolean;
}

/**
 * SimHub Telemetry Packet - Rich data from SimHub plugin
 * Contains calculated values that iRacing SDK doesn't expose:
 * - Sector times
 * - Accurate fuel remaining laps  
 * - Spotter with exact distances
 * - Tire wear/temp per corner
 */
export interface SimHubTelemetry {
  // Metadata
  timestamp: number;
  gameName: string;
  gameRunning: boolean;
  gamePaused: boolean;
  gameInMenu: boolean;
  gameReplay: boolean;
  spectating: boolean;

  // Track & Session
  trackName: string;
  trackCode: string;
  trackConfig: string;
  trackId: string;
  trackLength: number;
  reportedTrackLength: number;
  trackPositionPercent: number;
  trackPositionMeters: number;
  sessionTypeName: string;
  sessionTimeLeft: number;

  // Car ID
  carId: string;
  carModel: string;
  carClass: string;
  playerName: string;

  // Speed & RPM
  speedKmh: number;
  speedMph: number;
  speedLocal: number;
  rpms: number;
  maxRpm: number;
  redline: number;
  gear: string;

  // Inputs
  throttle: number;
  brake: number;
  clutch: number;

  // G-Forces
  accelerationSurge: number;
  accelerationSway: number;
  globalAccelerationG: number;

  // Tyres - Temperature (per corner)
  tyreTemperatureFrontLeft: number;
  tyreTemperatureFrontRight: number;
  tyreTemperatureRearLeft: number;
  tyreTemperatureRearRight: number;
  tyresTemperatureAvg: number;

  // Tyres - Temperature (inner/middle/outer for analysis)
  tyreTemperatureFrontLeftInner: number;
  tyreTemperatureFrontLeftMiddle: number;
  tyreTemperatureFrontLeftOuter: number;
  tyreTemperatureFrontRightInner: number;
  tyreTemperatureFrontRightMiddle: number;
  tyreTemperatureFrontRightOuter: number;
  tyreTemperatureRearLeftInner: number;
  tyreTemperatureRearLeftMiddle: number;
  tyreTemperatureRearLeftOuter: number;
  tyreTemperatureRearRightInner: number;
  tyreTemperatureRearRightMiddle: number;
  tyreTemperatureRearRightOuter: number;

  // Tyres - Pressure
  tyrePressureFrontLeft: number;
  tyrePressureFrontRight: number;
  tyrePressureRearLeft: number;
  tyrePressureRearRight: number;
  tyrePressureUnit: string;

  // Tyres - Wear
  tyreWearFrontLeft: number;
  tyreWearFrontRight: number;
  tyreWearRearLeft: number;
  tyreWearRearRight: number;
  tyresWearAvg: number;
  tyresWearMax: number;
  lastLapTyreWearFrontLeft: number;
  lastLapTyreWearFrontRight: number;
  lastLapTyreWearRearLeft: number;
  lastLapTyreWearRearRight: number;

  // Brakes
  brakeTemperatureFrontLeft: number;
  brakeTemperatureFrontRight: number;
  brakeTemperatureRearLeft: number;
  brakeTemperatureRearRight: number;
  brakesTemperatureAvg: number;
  brakeBias: number;

  // ⭐ FUEL - Calculated by SimHub
  fuel: number;
  fuelRaw: number;
  fuelPercent: number;
  maxFuel: number;
  fuelUnit: string;
  estimatedFuelRemaingLaps: number;  // Already calculated!
  instantConsumption_L100KM: number;

  // Environment
  airTemperature: number;
  roadTemperature: number;
  temperatureUnit: string;
  waterTemperature: number;
  oilTemperature: number;

  // Position & Laps
  position: number;
  playerLeaderboardPosition: number;
  currentLap: number;
  completedLaps: number;
  totalLaps: number;
  remainingLaps: number;

  // ⭐ SECTORS - The good stuff!
  currentLapTime: number;
  lastLapTime: number;
  bestLapTime: number;
  allTimeBest: number;
  lastSectorTime: number;
  currentSectorIndex: number;
  sectorsCount: number;
  sector1Time: number;
  sector2Time: number;
  sector1LastLapTime: number;
  sector2LastLapTime: number;
  sector3LastLapTime: number;
  sector1BestTime: number;
  sector2BestTime: number;
  sector3BestTime: number;
  sector1BestLapTime: number;
  sector2BestLapTime: number;
  sector3BestLapTime: number;
  isLapValid: boolean;
  lapInvalidated: boolean;
  deltaToSessionBest: number;
  deltaToAllTimeBest: number;
  bestSplitDelta: number;

  // Damage
  carDamage1: number;
  carDamage2: number;
  carDamage3: number;
  carDamage4: number;
  carDamage5: number;
  carDamagesAvg: number;
  carDamagesMax: number;

  // TC & ABS
  tcActive: boolean;
  tcLevel: number;
  absActive: boolean;
  absLevel: number;

  // Flags
  flag_Name: string;
  flag_Yellow: boolean;
  flag_Blue: boolean;
  flag_White: boolean;
  flag_Black: boolean;
  flag_Green: boolean;
  flag_Checkered: boolean;
  flag_Orange: boolean;

  // Pit
  isInPit: boolean;
  isInPitLane: boolean;
  isInPitSince: number;
  pitLimiterOn: boolean;
  pitLimiterSpeed: number;
  lastPitStopDuration: number;

  // ⭐ SPOTTER - With exact distances!
  spotterCarLeft: boolean;
  spotterCarLeftAngle: number;
  spotterCarLeftDistance: number;
  spotterCarRight: boolean;
  spotterCarRightAngle: number;
  spotterCarRightDistance: number;

  // Opponents
  opponentsCount: number;
  playerClassOpponentsCount: number;
  hasMultipleClassOpponents: boolean;
  driverAhead_Global?: SimHubOpponentInfo;
  driverBehind_Global?: SimHubOpponentInfo;
  driverAhead_Class?: SimHubOpponentInfo;
  driverBehind_Class?: SimHubOpponentInfo;
  opponentAhead?: SimHubOpponentInfo;
  opponentBehind?: SimHubOpponentInfo;
  leader?: SimHubOpponentInfo;
  gapToLeader?: number;

  // ERS/DRS (F1, etc.)
  ersStored: number;
  ersMax: number;
  ersPercent: number;
  drsAvailable: boolean;
  drsEnabled: boolean;

  // Turbo
  turbo: number;
  turboPercent: number;

  // iRacing Extra Properties (when running iRacing)
  iRacing_Player_iRating?: number;
  iRacing_Player_License?: string;
  iRacing_Player_SafetyRating?: string;
  iRacing_Player_CarNumber?: string;
  iRacing_Player_Position?: number;
  iRacing_Player_PositionInClass?: number;
  iRacing_Player_LapsSinceLastPit?: number;
  iRacing_FuelToAdd?: number;
  iRacing_FuelMaxFuelPerLap?: number;
  iRacing_SOF?: number;
  iRacing_TotalLaps?: number;
  iRacing_LapsRemaining?: number;
  iRacing_OptimalLapTime?: number;
  iRacing_PitWindowIsOpen?: boolean;
  iRacing_PitSpeedLimitKph?: number;
  iRacing_DistanceToPitEntry?: number;
  iRacing_CurrentSectorTime?: number;
  iRacing_CurrentSectorIndex?: number;
  iRacing_CurrentSectorBestTime?: number;
  iRacing_SessionBestLapTime?: number;
}

/**
 * SimHub message from WebSocket
 */
export interface SimHubMessage {
  type: 'simhub';
  timestamp: number;
  data: SimHubTelemetry;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Format lap time from seconds to MM:SS.mmm
 */
export function formatLapTime(seconds: number): string {
  if (!seconds || seconds <= 0) return "--:--.---";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toFixed(3).padStart(6, '0')}`;
}

/**
 * Format gap to string with sign
 */
export function formatGap(seconds: number): string {
  if (seconds === 0) return "0.000";
  const sign = seconds > 0 ? '+' : '';
  return `${sign}${seconds.toFixed(3)}s`;
}

/**
 * Format delta time with sign and color hint
 */
export function formatDelta(seconds: number): { text: string; positive: boolean } {
  const sign = seconds > 0 ? '+' : '';
  return {
    text: `${sign}${seconds.toFixed(3)}s`,
    positive: seconds <= 0,
  };
}
