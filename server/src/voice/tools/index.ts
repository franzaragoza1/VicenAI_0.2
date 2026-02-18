import { PythonCommandExecutor } from '../../python-commands.js';
import { getLatestTelemetryData } from '../../index.js';
import fetch from 'node-fetch';

/**
 * ToolHandlers - Implements all LLM tool handlers for telemetry reading
 */
export class ToolHandlers {
  constructor(
    private pythonExecutor: PythonCommandExecutor
  ) {}

  /**
   * get_session_context - Complete session context
   *
   * Returns timing, standings (all drivers with iRating/SR), gaps, flags
   */
  async getSessionContext(): Promise<any> {
    try {
      // Fetch standings from /api/standings
      const standings = await this.fetchStandings();

      // Get current telemetry
      const telemetry = getLatestTelemetryData();

      if (!telemetry) {
        return {
          error: 'No telemetry data available',
          meta: { timestamp: Date.now(), valid: false },
        };
      }

      return {
        timing: {
          currentLapTime: telemetry.lap?.currentLapTime || null,
          lastLapTime: telemetry.lap?.lastLapTime || null,
          bestLapTime: telemetry.lap?.bestLapTime || null,
          sessionBestLap: telemetry.session?.bestLapTime || null,
          delta: telemetry.lap?.delta || null,
          sectors: telemetry.lap?.sectors || [],
        },
        race: {
          position: telemetry.standings?.position || null,
          totalDrivers: standings?.length || 0,
          currentLap: telemetry.lap?.currentLap || 0,
          totalLaps: telemetry.lap?.totalLaps || 0,
          gapAhead: telemetry.rivals?.ahead?.gap || null,
          gapBehind: telemetry.rivals?.behind?.gap || null,
        },
        session: {
          type: telemetry.session?.type || 'unknown',
          track: telemetry.session?.trackName || 'unknown',
          trackConfig: telemetry.session?.trackConfig || null,
          car: telemetry.car?.name || 'unknown',
          flag: telemetry.session?.flag || 'green',
          pitLane: telemetry.pit?.inPitLane || false,
          timeRemaining: telemetry.session?.timeRemaining || null,
        },
        standings: standings || [],  // Full array with all drivers
        meta: {
          timestamp: Date.now(),
          valid: true,
          simulator: telemetry.simulator || 'unknown',
        },
      };
    } catch (error: any) {
      console.error('[ToolHandlers] get_session_context error:', error);
      return {
        error: `Failed to fetch session context: ${error.message}`,
        meta: { timestamp: Date.now(), valid: false },
      };
    }
  }

  /**
   * get_vehicle_setup - Vehicle setup data
   *
   * Returns suspension, tires, aero, brakes setup
   */
  async getVehicleSetup(): Promise<any> {
    try {
      // Request setup from Python executor (iRacing IRSDK)
      const setupData = await this.pythonExecutor.requestCurrentSetup();

      if (!setupData || setupData.error) {
        return {
          error: setupData?.error || 'Setup data not available',
          message: 'Vehicle setup is not available. Make sure you are in the car.',
        };
      }

      return setupData;  // Already formatted by Python side
    } catch (error: any) {
      console.error('[ToolHandlers] get_vehicle_setup error:', error);
      return {
        error: `Failed to fetch vehicle setup: ${error.message}`,
        message: 'Could not retrieve vehicle setup at this time.',
      };
    }
  }

  /**
   * get_recent_events - Recent race events
   *
   * Returns recent position changes, lap times, damage, flags
   *
   * @param limit - Number of events to return (default: 20)
   */
  async getRecentEvents(limit: number = 20): Promise<any> {
    // TODO: Implement event logger
    // For now, return placeholder indicating feature is not yet implemented

    return {
      events: [],
      message: 'Event logging not yet implemented. This feature will track position changes, lap times, and other race events in future updates.',
      meta: {
        timestamp: Date.now(),
        limit,
        implemented: false,
      },
    };
  }

  /**
   * compare_laps - Compare telemetry between two laps
   *
   * @param lap1Ref - First lap reference ("session_best", "last", or lap number)
   * @param lap2Ref - Second lap reference (default: "last")
   */
  async compareLaps(lap1Ref: string = 'session_best', lap2Ref: string = 'last'): Promise<any> {
    try {
      // Fetch lap data from /api/laps/{reference}
      const lap1Data = await this.fetchLapData(lap1Ref, true);  // includeTelemetry=true
      const lap2Data = await this.fetchLapData(lap2Ref, true);

      if (!lap1Data || !lap2Data) {
        return {
          error: 'Lap data not available',
          message: `Could not find lap data for references: ${lap1Ref}, ${lap2Ref}`,
        };
      }

      // Generate textual analysis
      const analysis = this.analyzeLapDifferences(lap1Data, lap2Data);

      // TODO: Generate visual comparison chart (Phase 2)
      // For now, return empty base64 as placeholder
      const imageBase64 = '';  // await this.generateLapComparisonChart(lap1Data, lap2Data);

      return {
        analysis,
        image: imageBase64,  // Base64 PNG for vision models (empty for v1)
        lap1: {
          reference: lap1Ref,
          number: lap1Data.number || lap1Ref,
          time: lap1Data.time || 0,
        },
        lap2: {
          reference: lap2Ref,
          number: lap2Data.number || lap2Ref,
          time: lap2Data.time || 0,
        },
        deltaTotal: (lap2Data.time || 0) - (lap1Data.time || 0),
        meta: {
          timestamp: Date.now(),
          imageIncluded: false,  // Will be true in Phase 2
        },
      };
    } catch (error: any) {
      console.error('[ToolHandlers] compare_laps error:', error);
      return {
        error: `Failed to compare laps: ${error.message}`,
        message: 'Could not compare laps at this time.',
      };
    }
  }

  // === PRIVATE HELPERS ===

  /**
   * Fetch standings from server API
   */
  private async fetchStandings(): Promise<any[]> {
    try {
      const response = await fetch('http://localhost:8081/api/standings');
      if (!response.ok) {
        console.warn('[ToolHandlers] Failed to fetch standings:', response.status);
        return [];
      }
      const data = await response.json() as any[];
      return data;
    } catch (error: any) {
      console.error('[ToolHandlers] fetchStandings error:', error);
      return [];
    }
  }

  /**
   * Fetch lap data from server API
   */
  private async fetchLapData(reference: string, includeTelemetry: boolean = false): Promise<any> {
    try {
      const params = includeTelemetry ? '?includeTelemetry=true' : '';
      const response = await fetch(`http://localhost:8081/api/laps/${reference}${params}`);
      if (!response.ok) {
        console.warn('[ToolHandlers] Failed to fetch lap data:', response.status);
        return null;
      }
      const data = await response.json();
      return data;
    } catch (error: any) {
      console.error('[ToolHandlers] fetchLapData error:', error);
      return null;
    }
  }

  /**
   * Analyze differences between two laps
   */
  private analyzeLapDifferences(lap1: any, lap2: any): string {
    const delta = (lap2.time || 0) - (lap1.time || 0);
    const direction = delta > 0 ? 'slower' : 'faster';
    const lap1Name = lap1.number ? `lap ${lap1.number}` : 'reference lap';
    const lap2Name = lap2.number ? `lap ${lap2.number}` : 'comparison lap';

    let analysis = `${lap2Name} was ${Math.abs(delta).toFixed(3)}s ${direction} than ${lap1Name}. `;

    // Sector-by-sector comparison (if available)
    if (lap1.sectors && lap2.sectors && lap1.sectors.length === lap2.sectors.length) {
      for (let i = 0; i < lap1.sectors.length; i++) {
        const sectorDelta = lap2.sectors[i] - lap1.sectors[i];
        if (Math.abs(sectorDelta) > 0.05) {  // Only mention significant differences
          const sectorDir = sectorDelta > 0 ? 'lost' : 'gained';
          analysis += `Sector ${i + 1}: ${sectorDir} ${Math.abs(sectorDelta).toFixed(3)}s. `;
        }
      }
    }

    // If no significant sector differences mentioned, add general note
    if (!analysis.includes('Sector')) {
      analysis += 'Sector times are similar overall.';
    }

    return analysis.trim();
  }

  /**
   * Generate lap comparison chart (Phase 2)
   *
   * TODO: Port chart generation logic from client/src/services/lap-comparison.ts
   * to run server-side using node-canvas or chartjs-node-canvas
   */
  private async generateLapComparisonChart(lap1: any, lap2: any): Promise<string> {
    // Placeholder for Phase 2 implementation
    // Will generate PNG chart with Speed, Throttle, Brake, Gear, Steering traces
    return '';
  }
}
