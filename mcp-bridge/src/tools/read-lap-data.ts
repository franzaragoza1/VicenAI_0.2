import { httpClient } from '../data-sources/http-client.js';
import { logger } from '../utils/logger.js';

export const readLapDataTool = {
  name: 'read_lap_data',
  description: 'Gets lap data from VICEN server. Can fetch session-best, last lap, or a specific lap by number.',
  inputSchema: {
    type: 'object',
    properties: {
      lapReference: {
        type: 'string',
        description: 'Which lap to fetch: "session-best", "last", or a specific lap number (default: "session-best")',
      },
      includeTelemetry: {
        type: 'boolean',
        description: 'Include full telemetry points data (default: false)',
      },
    },
  },
};

export async function readLapData(args: {
  lapReference?: string;
  includeTelemetry?: boolean;
}): Promise<{
  success: boolean;
  summary?: {
    lapNumber: number;
    lapTime: string;
    delta: string;
    trackName: string;
    carName: string;
    sessionType: string;
    timestamp: string;
  };
  telemetry?: any[];
  raw?: any;
  error?: string;
}> {
  const lapRef = args.lapReference || 'session-best';
  const includeTelemetry = args.includeTelemetry || false;

  try {
    logger.debug(`Fetching lap data: ${lapRef}`);

    // Determine endpoint based on reference
    let endpoint: string;
    if (lapRef === 'session-best' || lapRef === 'session_best') {
      endpoint = '/api/laps/session-best';
    } else if (lapRef === 'last') {
      endpoint = '/api/laps/last';
    } else {
      // Assume it's a lap number or ID
      endpoint = `/api/laps/${lapRef}`;
    }

    const response = await httpClient.get(endpoint);

    if (!response.success) {
      return {
        success: false,
        error: response.error || 'Failed to fetch lap data',
      };
    }

    const lap = response.data;

    if (!lap) {
      return {
        success: false,
        error: 'No lap data returned',
      };
    }

    // Format summary
    const summary = {
      lapNumber: lap.lapNumber || 0,
      lapTime: formatTime(lap.lapTime),
      delta: lap.delta != null ? formatDelta(lap.delta) : 'N/A',
      trackName: lap.trackName || 'Unknown',
      carName: lap.carName || 'Unknown',
      sessionType: lap.sessionType || 'Unknown',
      timestamp: lap.timestamp || new Date().toISOString(),
    };

    const result: any = {
      success: true,
      summary,
    };

    if (includeTelemetry && lap.points) {
      result.telemetry = lap.points;
      result.raw = lap;
    }

    return result;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Error reading lap data:', errorMsg);

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

function formatDelta(delta: number): string {
  const sign = delta >= 0 ? '+' : '';
  return `${sign}${delta.toFixed(3)}s`;
}
