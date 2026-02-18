/**
 * Telemetry Data Sanitizer
 * =========================
 * 
 * Validates and normalizes telemetry data before sending to Gemini.
 * Prevents invalid values (undefined, negative positions, fuel >100%, etc.)
 * from reaching the AI context.
 * 
 * Philosophy:
 * - Better to say "unknown" than to send garbage
 * - Validate early, fail gracefully
 * - Log warnings for debugging but don't crash
 */

import type { TelemetryData } from '../types/telemetry.types';

/**
 * Sanitized telemetry ready for context generation
 */
export interface SanitizedTelemetry {
  // Position data - guaranteed valid or null
  position: {
    overall: number | null;      // 1-based position or null if unknown
    totalCars: number | null;     // Total cars in session or null
    inClass: number | null;       // Position in class or null
  };
  
  // Timing data - guaranteed valid or null
  timing: {
    currentLap: number | null;    // Current lap number (0+ or null)
    lastLapTime: number | null;   // Last lap time in seconds (>0 or null)
    bestLapTime: number | null;   // Best lap time in seconds (>0 or null)
  };
  
  // Fuel data - guaranteed valid percentages and values
  fuel: {
    level: number | null;         // Current fuel in liters (0+ or null)
    capacity: number | null;      // Tank capacity in liters (>0 or null)
    lapsRemaining: number | null; // Estimated laps remaining (0+ or null)
    percentRemaining: number | null; // Percentage (0-100 or null)
  };
  
  // Gap data - guaranteed valid or null
  gaps: {
    ahead: number | null;         // Gap to car ahead in seconds (0+ or null)
    behind: number | null;        // Gap to car behind in seconds (0+ or null)
    toLeader: number | null;      // Gap to leader in seconds (0+ or null)
  };
  
  // Session info - guaranteed valid
  session: {
    type: string;                 // Session type (never empty)
    trackName: string;            // Track name (never empty)
    carName: string;              // Car name (never empty)
    simulator: string;            // Simulator name (never empty)
  };
  
  // Data quality indicator
  quality: {
    hasValidPosition: boolean;    // Position data is reliable
    hasValidTiming: boolean;      // Timing data is reliable
    hasValidFuel: boolean;        // Fuel data is reliable
    isComplete: boolean;          // All critical data is present
    warnings: string[];           // List of data quality warnings
  };
}

/**
 * Sanitize a numeric value - return null if invalid
 */
function sanitizeNumber(value: any, min: number = -Infinity, max: number = Infinity): number | null {
  if (value === null || value === undefined || typeof value !== 'number') {
    return null;
  }
  if (isNaN(value) || !isFinite(value)) {
    return null;
  }
  if (value < min || value > max) {
    return null;
  }
  return value;
}

/**
 * Sanitize a positive number (must be >= 0)
 */
function sanitizePositive(value: any): number | null {
  return sanitizeNumber(value, 0);
}

/**
 * Sanitize a positive integer (must be >= 0 and whole number)
 */
function sanitizePositiveInt(value: any): number | null {
  const num = sanitizeNumber(value, 0);
  if (num === null) return null;
  return Math.floor(num);
}

/**
 * Sanitize a percentage (must be 0-100)
 */
function sanitizePercentage(value: any): number | null {
  return sanitizeNumber(value, 0, 100);
}

/**
 * Sanitize a string - return default if empty/invalid
 */
function sanitizeString(value: any, defaultValue: string): string {
  if (!value || typeof value !== 'string' || value.trim().length === 0) {
    return defaultValue;
  }
  return value.trim();
}

/**
 * Sanitize position data
 */
function sanitizePosition(data: TelemetryData): SanitizedTelemetry['position'] {
  const overall = sanitizePositiveInt(data.position?.overall);
  const totalCars = sanitizePositiveInt(data.position?.totalCars);
  const inClass = sanitizePositiveInt(data.position?.class);
  
  // 🔒 CRITICAL: totalCars = 0 is invalid (means no data)
  if (totalCars !== null && totalCars === 0) {
    return { overall: null, totalCars: null, inClass: null };
  }
  
  // Validate relationships
  if (overall !== null && totalCars !== null) {
    if (overall < 1 || overall > totalCars) {
      // Position out of range - invalidate both
      return { overall: null, totalCars: null, inClass: null };
    }
  }
  
  return { overall, totalCars, inClass };
}

/**
 * Sanitize timing data
 */
function sanitizeTiming(data: TelemetryData): SanitizedTelemetry['timing'] {
  const currentLap = sanitizePositiveInt(data.timing?.currentLap);
  
  // Lap times must be positive if present
  const lastLapTime = sanitizePositive(data.timing?.lastLapTime);
  const bestLapTime = sanitizePositive(data.timing?.bestLapTime);
  
  return {
    currentLap: currentLap !== null && currentLap >= 0 ? currentLap : null,
    lastLapTime: lastLapTime && lastLapTime > 0 ? lastLapTime : null,
    bestLapTime: bestLapTime && bestLapTime > 0 ? bestLapTime : null,
  };
}

/**
 * Sanitize fuel data with special attention to percentages
 */
function sanitizeFuel(data: TelemetryData): SanitizedTelemetry['fuel'] {
  let level = sanitizePositive(data.fuel?.level);
  const capacity = sanitizePositive(data.fuel?.maxLtr);
  const lapsRemainingRaw = data.fuel?.lapsRemaining ?? data.fuel?.estimatedLapsRemaining;
  let lapsRemaining = sanitizePositive(lapsRemainingRaw);
  
  // 🔒 CRITICAL FIX: If fuel is extremely low (likely 0.0) but capacity is valid,
  // it's probably a sensor glitch or initialization error.
  // Treat as "unknown" (null) instead of "empty" (0) to avoid false alerts.
  if (level !== null && level < 0.5 && capacity !== null && capacity > 0) {
    // Only invalidate if capacity > 0 (to allow for weird cars with 0 capacity?)
    // But realistically, 0.0L is always an error in a running session
    level = null;
  }

  let percentRemaining: number | null = null;
  
  // Calculate percentage only if both values are valid
  if (level !== null && capacity !== null && capacity > 0) {
    const rawPercent = (level / capacity) * 100;
    // Clamp to 0-100 (prevent >100% readings)
    percentRemaining = Math.max(0, Math.min(100, rawPercent));
    
    // If fuel exceeds capacity by >5%, mark it as suspicious
    if (rawPercent > 105) {
      percentRemaining = null; // Data is too inconsistent
    }
  }
  
  // If laps estimate is 0 but we still have fuel, treat as unknown
  if (lapsRemaining !== null && lapsRemaining <= 0 && level !== null && level > 0.5) {
    lapsRemaining = null;
  }

  return { level, capacity, lapsRemaining, percentRemaining };
}

/**
 * Sanitize gap data
 */
function sanitizeGaps(data: TelemetryData): SanitizedTelemetry['gaps'] {
  const ahead = sanitizePositive(data.gaps?.ahead || data.gaps?.toCarAhead);
  const behind = sanitizePositive(data.gaps?.behind || data.gaps?.toCarBehind);
  const toLeader = sanitizePositive(data.gaps?.toLeader);
  
  // Gaps > 999s are probably invalid (off-track, disconnected, etc.)
  return {
    ahead: ahead !== null && ahead < 999 ? ahead : null,
    behind: behind !== null && behind < 999 ? behind : null,
    toLeader: toLeader !== null && toLeader < 999 ? toLeader : null,
  };
}

/**
 * Sanitize session info (always provide defaults)
 */
function sanitizeSession(data: TelemetryData): SanitizedTelemetry['session'] {
  return {
    type: sanitizeString(data.session?.type, 'Practice'),
    trackName: sanitizeString(data.session?.trackName, 'Unknown Track'),
    carName: sanitizeString(data.session?.carName, 'Unknown Car'),
    simulator: sanitizeString(data.simulator, 'iRacing'),
  };
}

/**
 * Assess data quality and generate warnings
 */
function assessQuality(sanitized: Omit<SanitizedTelemetry, 'quality'>): SanitizedTelemetry['quality'] {
  const warnings: string[] = [];
  
  // Check position validity
  const hasValidPosition = sanitized.position.overall !== null && 
                          sanitized.position.totalCars !== null &&
                          sanitized.position.overall > 0;
  
  if (!hasValidPosition) {
    warnings.push('Position data unavailable or invalid');
  }
  
  // Check timing validity
  const hasValidTiming = sanitized.timing.currentLap !== null ||
                        sanitized.timing.lastLapTime !== null;
  
  if (!hasValidTiming) {
    warnings.push('Timing data unavailable');
  }
  
  // Check fuel validity
  const hasValidFuel = sanitized.fuel.level !== null && 
                      sanitized.fuel.capacity !== null &&
                      sanitized.fuel.percentRemaining !== null;
  
  if (!hasValidFuel && sanitized.fuel.capacity !== null) {
    warnings.push('Fuel data incomplete or inconsistent');
  }
  
  // Overall completeness
  const isComplete = hasValidPosition && hasValidTiming && hasValidFuel;
  
  return {
    hasValidPosition,
    hasValidTiming,
    hasValidFuel,
    isComplete,
    warnings,
  };
}

/**
 * Main sanitization function
 * 
 * @param data Raw telemetry data from simulator
 * @returns Sanitized telemetry with guaranteed valid values
 */
export function sanitizeTelemetry(data: TelemetryData): SanitizedTelemetry {
  const position = sanitizePosition(data);
  const timing = sanitizeTiming(data);
  const fuel = sanitizeFuel(data);
  const gaps = sanitizeGaps(data);
  const session = sanitizeSession(data);
  
  const quality = assessQuality({ position, timing, fuel, gaps, session });
  
  // Log warnings if data quality is poor
  if (quality.warnings.length > 0) {
    console.warn('[Sanitizer] Data quality warnings:', quality.warnings);
  }
  
  return {
    position,
    timing,
    fuel,
    gaps,
    session,
    quality,
  };
}

/**
 * Format sanitized value for display in context
 * Returns "?" for null values instead of literal "null" or "undefined"
 */
export function formatSanitized(value: number | string | null, suffix: string = ''): string {
  if (value === null) return '?';
  return `${value}${suffix}`;
}

/**
 * Format position string (e.g., "P3/24" or "P?/?" if invalid)
 */
export function formatPosition(sanitized: SanitizedTelemetry): string {
  const pos = formatSanitized(sanitized.position.overall);
  const total = formatSanitized(sanitized.position.totalCars);
  return `P${pos}/${total}`;
}

/**
 * Format lap number (e.g., "Lap 5" or "Lap ?" if invalid)
 */
export function formatLap(sanitized: SanitizedTelemetry): string {
  return `Lap ${formatSanitized(sanitized.timing.currentLap)}`;
}

/**
 * Format fuel percentage (e.g., "45%" or "?%" if invalid)
 */
export function formatFuelPercent(sanitized: SanitizedTelemetry): string {
  const percent = sanitized.fuel.percentRemaining;
  if (percent === null) return '?%';
  return `${Math.round(percent)}%`;
}

/**
 * Format fuel amount (e.g., "15.2L/55L" or "?L/?L" if invalid)
 */
export function formatFuelAmount(sanitized: SanitizedTelemetry): string {
  const level = sanitized.fuel.level;
  const capacity = sanitized.fuel.capacity;
  
  if (level === null || capacity === null) {
    return '?L/?L';
  }
  
  return `${level.toFixed(1)}L/${capacity.toFixed(0)}L`;
}

/**
 * Check if data quality is sufficient to send session_joined
 * 
 * Uses real completeness signals instead of defaults:
 * - Checks actual participant data, not just counts
 * - Validates track/car names aren't default placeholders
 * - Requires SoF > 0 for multiplayer sessions
 */
/**
 * Check if data quality is sufficient to send session_joined
 * 
 * 🔒 STRICT GATING: Never sends with totalDrivers: 0
 * Uses real completeness signals instead of defaults:
 * - Checks actual participant data, not just counts
 * - Validates track/car names aren't default placeholders
 * - Requires SoF > 0 for multiplayer sessions
 */
export function canSendSessionJoined(
  sanitized: SanitizedTelemetry,
  participantCount: number,
  strengthOfField: number,
  standings: any[] = []
): boolean {
  // 🔒 CRITICAL: Never send with totalDrivers: 0
  // This is the most common case of "no data ready"
  if (participantCount === 0) {
    return false;
  }
  
  // 🔒 Reject default/placeholder values
  const hasValidTrack = sanitized.session.trackName && 
                       sanitized.session.trackName !== 'Unknown' &&
                       sanitized.session.trackName !== 'Unknown Track';
  
  const hasValidCar = sanitized.session.carName && 
                     sanitized.session.carName !== 'Unknown' &&
                     sanitized.session.carName !== 'Unknown Car';
  
  if (!hasValidTrack || !hasValidCar) {
    return false;
  }
  
  // 🔒 For multiplayer sessions, require real participant data
  if (participantCount > 1) {
    // Must have real SoF (not 0)
    if (strengthOfField <= 0) {
      return false;
    }
    
    // Must have actual standings data (not empty array)
    // Use standings.length as primary signal, not just participantCount
    if (!standings || standings.length === 0) {
      return false;
    }
    
    // Standings count should match or be close to participantCount
    // Allow some variance for disconnects/DNF
    if (standings.length < Math.floor(participantCount * 0.5)) {
      return false; // Less than 50% of expected drivers = incomplete data
    }
    
    // Validate standings have real names (not undefined/null/Unknown)
    const hasValidNames = standings.some(s => 
      (s.userName || s.name) && 
      s.userName !== 'Unknown' && 
      s.name !== 'Unknown' &&
      s.userName !== undefined &&
      s.name !== undefined
    );
    
    if (!hasValidNames) {
      return false;
    }
  }
  
  // For solo sessions (practice/testing), allow with basic info
  return true;
}
