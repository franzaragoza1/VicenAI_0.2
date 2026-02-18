import { httpClient } from '../data-sources/http-client.js';
import { logger } from '../utils/logger.js';

export const readTelemetrySnapshotTool = {
  name: 'read_telemetry_snapshot',
  description: 'Gets current telemetry snapshot from the VICEN server. Returns formatted summary of current racing data.',
  inputSchema: {
    type: 'object',
    properties: {
      includeRaw: {
        type: 'boolean',
        description: 'Include full raw telemetry data (default: false)',
      },
    },
  },
};

export async function readTelemetrySnapshot(args: {
  includeRaw?: boolean;
}): Promise<{
  success: boolean;
  summary?: {
    simulator: string;
    track: string;
    car: string;
    position: number;
    speed: number;
    rpm: number;
    gear: number;
    fuel: number;
    lapTime: string;
    lastLapTime: string;
    inPits: boolean;
  };
  raw?: any;
  error?: string;
}> {
  try {
    logger.debug('Fetching telemetry snapshot');

    const response = await httpClient.get('/api/latest');

    if (!response.success) {
      return {
        success: false,
        error: response.error || 'Failed to fetch telemetry',
      };
    }

    const telemetry = response.data;

    // Check if telemetry data exists
    if (!telemetry || (!telemetry.iRacing && !telemetry.simhub)) {
      return {
        success: false,
        error: 'No telemetry data available',
      };
    }

    // Use iRacing data if available, otherwise SimHub
    const data = telemetry.iRacing || telemetry.simhub;

    // Format summary
    const summary = {
      simulator: telemetry.iRacing ? 'iRacing' : 'SimHub',
      track: data.track || data.TrackDisplayName || 'Unknown',
      car: data.car || data.CarModel || 'Unknown',
      position: data.position || data.Position || 0,
      speed: Math.round(data.speed || data.SpeedKmh || 0),
      rpm: Math.round(data.rpm || data.Rpms || 0),
      gear: data.gear || data.Gear || 0,
      fuel: parseFloat((data.fuel || data.FuelPercent || 0).toFixed(2)),
      lapTime: formatTime(data.lapTime || data.CurrentLapTime || 0),
      lastLapTime: formatTime(data.lastLapTime || data.LastLapTime || 0),
      inPits: data.inPits || data.IsInPitLane || false,
    };

    const result: any = {
      success: true,
      summary,
    };

    if (args.includeRaw) {
      result.raw = telemetry;
    }

    return result;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Error reading telemetry:', errorMsg);

    return {
      success: false,
      error: errorMsg,
    };
  }
}

function formatTime(seconds: number): string {
  if (!seconds || seconds <= 0) return '0:00.000';

  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const millis = Math.floor((seconds % 1) * 1000);

  return `${minutes}:${secs.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
}
