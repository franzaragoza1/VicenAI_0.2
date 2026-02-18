/**
 * Telemetry Utilities
 * ===================
 * 
 * Simple mappers from raw telemetry to context formats for Gemini.
 * 
 * Philosophy:
 * - Format data for consumption
 * - Map structures, don't analyze
 * - NO strategic calculations (that's Gemini's job)
 */

import type { 
  TelemetryData, 
  SessionContext, 
  CompetitionContext, 
  FullTelemetry,
} from '../types/telemetry.types';
import { formatLapTime, formatGap } from '../types/telemetry.types';
import { 
  getMyStanding, 
  getMyClassName, 
  getClassStandings, 
  getClassLeader 
} from './multiclass.utils';

// Re-export formatLapTime for backwards compatibility
export { formatLapTime, formatGap } from '../types/telemetry.types';

/**
 * UTILITY: Safe format time for Gemini
 * Converts seconds to "M:SS.mmm" format (e.g., 84.465 → "1:24.465")
 * This prevents Gemini from confusing 120s with "1:20" instead of "2:00"
 * Handles null/undefined/0 gracefully
 */
export function formatTimeForGemini(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || seconds <= 0) return "N/A";

  // Convert to mm:ss.ms format to avoid confusion
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  // Format with 3 decimal places for milliseconds
  const secondsStr = remainingSeconds.toFixed(3).padStart(6, '0');

  return `${minutes}:${secondsStr}`;
}

/**
 * Creates a SessionContext from raw telemetry.
 * Used by Gemini's get_session_context tool.
 * 
 * Provides COMPLETE session context - Gemini needs all data to make decisions.
 */
export function createSessionContext(data: TelemetryData | null): SessionContext {
  if (!data) {
    return {
      timing: {
        lastLapTime: null,
        bestLapTime: null,
        deltaToBest: null,
        deltaToSessionBest: null,
        currentLap: 0,
        lapsCompleted: 0,
        lapDistPct: 0,
      },
      race: {
        position: 0,
        classPosition: 0,
        totalCars: 0,
        gapAhead: null,
        gapBehind: null,
        gapToLeader: null,
      },
      session: {
        trackName: "Unknown",
        trackConfig: "",
        trackLength: "",
        carName: "Unknown",
        type: "Unknown",
        name: "",
        state: "unknown",
        sessionTime: "",
        timeRemaining: 0,
        lapsRemaining: 0,
        lapsTotal: 0,
        raceLaps: 0,
        estLapTime: 0,
        lapsRemainingRaw: 0,
        lapsTotalRaw: 0,
        lapsRemainingEstimated: null,
        timeRemainingMinutes: null,
        numLeadChanges: 0,
        numCautionFlags: 0,
        numCautionLaps: 0,
        flags: {
          yellow: false,
          blue: false,
          white: false,
          checkered: false,
          active: [],
        },
      },
      fuel: {
        level: 0,
        pct: 0,
        usedLastLap: 0,
        perLapAvg: 0,
        maxLtr: 0,
        estimatedLapsRemaining: -1,
        estimatedLapsRemainingFromAvg: null,
      },
      pit: {
        inPitLane: false,
        inPitStall: false,
        pitsOpen: true,
        pitLimiterOn: false,
        repairTimeLeft: 0,
        optRepairTimeLeft: 0,
        fastRepairAvailable: 0,
        fastRepairUsed: 0,
      },
      track: {
        tempCelsius: 0,
        airTempCelsius: 0,
        wetness: 0,
        skies: 0,
        weatherDeclaredWet: false,
      },
      incidents: {
        count: 0,
        teamCount: 0,
        limit: 0,
      },
      tires: {
        setsAvailable: 0,
        setsUsed: 0,
        compound: 0,
      },
      standings: [],
    };
  }

  // Validate lap times - LMU uses 0 and -1 for "no data"
  // Ensure we don't pass invalid values to Gemini
  const lastLap = (data.timing?.lastLapTime && data.timing.lastLapTime > 0)
    ? data.timing.lastLapTime
    : null;
  
  const bestLap = (data.timing?.bestLapTime && data.timing.bestLapTime > 0)
    ? data.timing.bestLapTime
    : null;
  
  const deltaToBest = data.timing?.deltaToBest;
  const deltaToSessionBest = data.timing?.deltaToSessionBest;
  const fuelPerLap = data.fuel?.perLapAvg || 0;
  const fuelLevel = data.fuel?.level || 0;
  const rawLapsRemaining = data.session?.lapsRemaining ?? 0;
  const rawLapsTotal = data.session?.lapsTotal ?? 0;
  const rawTimeRemaining = data.session?.timeRemaining ?? 0;
  const estLapTime = data.session?.estLapTime ?? 0;

  const isSentinel = (v: number): boolean => v >= 32760;
  const lapsRemaining = rawLapsRemaining && !isSentinel(rawLapsRemaining) ? rawLapsRemaining : 0;
  const lapsTotal = rawLapsTotal && !isSentinel(rawLapsTotal) ? rawLapsTotal : 0;
  const timeRemainingMinutes =
    typeof rawTimeRemaining === 'number' && rawTimeRemaining > 0
      ? Math.round((rawTimeRemaining / 60) * 10) / 10
      : null;
  const lapsRemainingEstimated =
    lapsRemaining > 0
      ? lapsRemaining
      : rawTimeRemaining > 0 && estLapTime > 0
        ? Math.max(0, Math.floor(rawTimeRemaining / estLapTime))
        : null;

  const estimatedLapsRemainingFromAvg =
    fuelPerLap > 0.1 && fuelLevel > 0
      ? Math.round((fuelLevel / fuelPerLap) * 10) / 10
      : null;

  return {
    timing: {
      // Tiempos en SEGUNDOS - Gemini los convertirá a formato hablado
      // null = no hay datos disponibles (primera vuelta, etc.)
      lastLapTime: lastLap,
      bestLapTime: bestLap,
      deltaToBest: deltaToBest,
      deltaToSessionBest: deltaToSessionBest,
      currentLap: data.timing?.currentLap || 0,
      lapsCompleted: data.timing?.lapsCompleted || 0,
      lapDistPct: data.timing?.lapDistPct || 0,
    },
    race: {
      position: data.position?.overall || 0,
      classPosition: data.position?.class || 0,
      totalCars: data.position?.totalCars || 0,
      // Gaps en SEGUNDOS - Gemini los convertirá a formato hablado
      gapAhead: data.gaps?.ahead || null,
      gapBehind: data.gaps?.behind || null,
      gapToLeader: data.gaps?.toLeader || null,
    },
    session: {
      trackName: data.session?.trackName || "Unknown",
      trackConfig: data.session?.trackConfig || "",
      trackLength: data.session?.trackLength || "",
      carName: data.session?.carName || "Unknown",
      type: data.session?.type || "Unknown",
      name: data.session?.name || "",
      state: data.session?.state || "unknown",
      sessionTime: data.session?.sessionTime || "",
      timeRemaining: rawTimeRemaining || 0,
      lapsRemaining,
      lapsTotal,
      raceLaps: data.session?.raceLaps || 0,
      estLapTime,
      lapsRemainingRaw: rawLapsRemaining || 0,
      lapsTotalRaw: rawLapsTotal || 0,
      lapsRemainingEstimated,
      timeRemainingMinutes,
      trackRubberState: data.session?.trackRubberState || "",
      numLeadChanges: data.session?.numLeadChanges || 0,
      numCautionFlags: data.session?.numCautionFlags || 0,
      numCautionLaps: data.session?.numCautionLaps || 0,
      flags: {
        yellow: data.flags?.active?.includes('yellow') || data.flags?.active?.includes('caution') || false,
        blue: data.flags?.active?.includes('blue') || false,
        white: data.flags?.active?.includes('white') || false,
        checkered: data.flags?.active?.includes('checkered') || false,
        active: data.flags?.active || [],
      },
    },
    fuel: {
      level: fuelLevel,
      pct: data.fuel?.pct || 0,
      usedLastLap: data.fuel?.usedLastLap || 0,
      perLapAvg: fuelPerLap,
      maxLtr: data.fuel?.maxLtr || 0,
      estimatedLapsRemaining: typeof data.fuel?.estimatedLapsRemaining === 'number' && data.fuel.estimatedLapsRemaining > 0
        ? data.fuel.estimatedLapsRemaining
        : estimatedLapsRemainingFromAvg ?? -1,
      estimatedLapsRemainingFromAvg,
    },
    pit: {
      inPitLane: data.pit?.inPitLane || false,
      inPitStall: data.pit?.inPitStall || false,
      pitsOpen: data.pit?.pitsOpen ?? true,
      pitLimiterOn: data.pit?.pitLimiterOn || false,
      repairTimeLeft: data.pit?.repairTimeLeft || 0,
      optRepairTimeLeft: data.pit?.optRepairTimeLeft || 0,
      fastRepairAvailable: data.pit?.fastRepairAvailable || 0,
      fastRepairUsed: data.pit?.fastRepairUsed || 0,
    },
    track: {
      tempCelsius: data.track?.tempCelsius || 0,
      airTempCelsius: data.track?.airTempCelsius || 0,
      wetness: data.track?.wetness || 0,
      skies: data.track?.skies || 0,
      weatherDeclaredWet: data.track?.weatherDeclaredWet || false,
    },
    incidents: {
      count: data.incidents?.count || 0,
      teamCount: data.incidents?.teamCount || 0,
      limit: data.incidents?.limit || 0,
    },
    tires: {
      setsAvailable: data.tires?.setsAvailable || 0,
      setsUsed: data.tires?.setsUsed || 0,
      compound: data.tires?.compound || 0,
    },
    standings: data.standings || [],
    // 🏁 MULTICLASS: Build class context if available
    classContext: buildClassContext(data),
  };
}

/**
 * Build class context for multiclass sessions
 * Returns undefined if no class data available
 */
function buildClassContext(data: TelemetryData): SessionContext['classContext'] {
  const myStanding = getMyStanding(data);
  const myClassName = getMyClassName(data);
  
  if (!myStanding || !myClassName) {
    return undefined;
  }

  const classStandings = getClassStandings(data);
  if (classStandings.length === 0) {
    return undefined;
  }

  const classLeader = getClassLeader(classStandings);

  return {
    className: myClassName,
    classPosition: myStanding.classPosition,
    classTotalCars: classStandings.length,
    classLeader: classLeader ? {
      name: classLeader.userName || classLeader.name || '?',
      carNumber: classLeader.carNumber,
      iRating: classLeader.iRating,
      license: classLeader.license,
      fastestTime: classLeader.fastestTime,
    } : undefined,
    standingsInClass: classStandings,
  };
}

/**
 * Creates a CompetitionContext from raw telemetry.
 * Used for strategic analysis by Gemini.
 * 
 * Maps data to expected format - NO strategic analysis.
 * Gemini decides what's "pressure", "critical", etc.
 */
export function createCompetitionContext(data: TelemetryData | null): CompetitionContext {
  if (!data) {
    return {
      timing: {
        lastLapTime: 0,
        deltaToSessionBest: 0,
      },
      race: {
        position: 0,
        gapAhead: 0,
        gapBehind: 0,
      },
      session: {
        flags: {
          yellow: false,
          blue: false,
        },
      },
      situation: {
        isBeingPressured: false,
        isHeldUp: false,
      },
      strategy: {
        fuelLapsRemaining: 0,
      },
    };
  }

  const fuelPerLap = data.fuel?.perLapAvg || 0;
  const fuelLevel = data.fuel?.level || 0;

  return {
    timing: {
      lastLapTime: data.timing?.lastLapTime || 0,
      deltaToSessionBest: data.timing?.deltaToSessionBest || 0,
    },
    race: {
      position: data.position?.overall || 0,
      gapAhead: data.gaps?.ahead || 0,
      gapBehind: data.gaps?.behind || 0,
    },
    session: {
      flags: {
        yellow: data.flags?.active?.includes('yellow') || data.flags?.active?.includes('caution') || false,
        blue: data.flags?.active?.includes('blue') || false,
      },
    },
    situation: {
      isBeingPressured: false,
      isHeldUp: false,
      pressureGap: data.gaps?.behind,
      heldUpGap: data.gaps?.ahead,
    },
    strategy: {
      fuelLapsRemaining: fuelPerLap > 0 ? Math.floor(fuelLevel / fuelPerLap) : 0,
    },
  };
}

/**
 * Creates a FullTelemetry object for tools that need everything.
 * Just passes through the raw data.
 */
export function createFullTelemetry(data: TelemetryData | null): FullTelemetry {
  if (!data) {
    return {};
  }
  
  // Flatten the nested structure for easier access
  return {
    ...data,
    // Add some convenience fields at top level
    currentLap: data.timing?.currentLap,
    lastLapTime: data.timing?.lastLapTime,
    bestLapTime: data.timing?.bestLapTime,
    racePosition: data.position?.overall,
    classPosition: data.position?.class,
    fuelLevel: data.fuel?.level,
    fuelPerLap: data.fuel?.perLapAvg,
    inPitLane: data.pit?.inPitLane,
    trackName: data.session?.trackName,
    carName: data.session?.carName,
  };
}

/**
 * Format session time remaining as human-readable string
 */
export function formatSessionTime(seconds: number): string {
  if (seconds <= 0) return "Unlimited";
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Check if telemetry indicates an active racing session
 */
export function isActiveSession(data: TelemetryData | null): boolean {
  if (!data) return false;
  
  const activeStates = ['warmup', 'parade_laps', 'racing', 'checkered'];
  return activeStates.includes(data.session?.state || '');
}
