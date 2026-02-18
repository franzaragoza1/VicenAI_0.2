import fs from 'fs/promises';
import { config } from '../config.js';
import { httpClient } from '../data-sources/http-client.js';
import { logger } from '../utils/logger.js';

export const listAvailableDataTool = {
  name: 'list_available_data',
  description: 'Performs health check on all VICEN data sources. Returns availability status of logs, server, telemetry, and laps.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
};

interface DataSource {
  available: boolean;
  details?: string;
  error?: string;
}

export async function listAvailableData(): Promise<{
  success: boolean;
  sources: {
    geminiLogs: DataSource;
    server: DataSource;
    telemetry: DataSource;
    laps: DataSource;
  };
}> {
  logger.debug('Performing health check on all data sources');

  const results = await Promise.allSettled([
    checkGeminiLogs(),
    checkServer(),
    checkTelemetry(),
    checkLaps(),
  ]);

  return {
    success: true,
    sources: {
      geminiLogs: results[0].status === 'fulfilled' ? results[0].value : { available: false, error: 'Check failed' },
      server: results[1].status === 'fulfilled' ? results[1].value : { available: false, error: 'Check failed' },
      telemetry: results[2].status === 'fulfilled' ? results[2].value : { available: false, error: 'Check failed' },
      laps: results[3].status === 'fulfilled' ? results[3].value : { available: false, error: 'Check failed' },
    },
  };
}

async function checkGeminiLogs(): Promise<DataSource> {
  try {
    await fs.access(config.geminiLogsDir);

    const files = await fs.readdir(config.geminiLogsDir);
    const logFiles = files.filter((f) => f.startsWith('gemini-logs-') && f.endsWith('.json'));

    if (logFiles.length === 0) {
      return {
        available: false,
        details: 'Logs directory exists but no log files found',
      };
    }

    return {
      available: true,
      details: `${logFiles.length} log file(s) found`,
    };
  } catch {
    return {
      available: false,
      error: `Logs directory not found: ${config.geminiLogsDir}`,
    };
  }
}

async function checkServer(): Promise<DataSource> {
  try {
    const response = await httpClient.get('/api/health');

    if (!response.success) {
      return {
        available: false,
        error: response.error || 'Server not responding',
      };
    }

    return {
      available: true,
      details: `Server running at ${config.serverBaseUrl}`,
    };
  } catch (error) {
    return {
      available: false,
      error: `Server unreachable at ${config.serverBaseUrl}`,
    };
  }
}

async function checkTelemetry(): Promise<DataSource> {
  try {
    const response = await httpClient.get('/api/latest');

    if (!response.success) {
      return {
        available: false,
        error: response.error || 'Telemetry endpoint failed',
      };
    }

    const data = response.data;
    const hasIRacing = data?.iRacing != null;
    const hasSimHub = data?.simhub != null;

    if (!hasIRacing && !hasSimHub) {
      return {
        available: false,
        details: 'No active telemetry data',
      };
    }

    const source = hasIRacing ? 'iRacing' : 'SimHub';
    return {
      available: true,
      details: `Active telemetry from ${source}`,
    };
  } catch (error) {
    return {
      available: false,
      error: 'Telemetry endpoint unreachable',
    };
  }
}

async function checkLaps(): Promise<DataSource> {
  try {
    const response = await httpClient.get('/api/laps');

    if (!response.success) {
      return {
        available: false,
        error: response.error || 'Laps endpoint failed',
      };
    }

    const laps = response.data;

    if (!laps || !Array.isArray(laps.laps) || laps.laps.length === 0) {
      return {
        available: false,
        details: 'No laps stored',
      };
    }

    return {
      available: true,
      details: `${laps.laps.length} lap(s) stored`,
    };
  } catch (error) {
    return {
      available: false,
      error: 'Laps endpoint unreachable',
    };
  }
}
