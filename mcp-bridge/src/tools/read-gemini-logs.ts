import fs from 'fs/promises';
import path from 'path';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export const readGeminiLogsTool = {
  name: 'read_gemini_logs',
  description: 'Reads Gemini Live logs from disk. Returns recent log entries with filtering options.',
  inputSchema: {
    type: 'object',
    properties: {
      lines: {
        type: 'number',
        description: `Maximum number of log entries to return (default: 20, max: ${config.maxLogLines})`,
        minimum: 1,
        maximum: config.maxLogLines,
      },
      category: {
        type: 'string',
        description: 'Filter logs by category (e.g., "user_message", "context", "tool_call", "response")',
      },
    },
  },
};

interface GeminiLogEntry {
  timestamp: string;
  type: 'sent' | 'received' | 'error' | 'tool' | 'event';
  category: string;
  content: string;
  metadata?: Record<string, any>;
}

interface LogFile {
  sessionInfo: {
    instanceId: string;
    startTime: string;
    totalConnections: number;
    totalDisconnections: number;
    totalErrors: number;
  };
  summary: Record<string, any>;
  logs: GeminiLogEntry[];
}

export async function readGeminiLogs(args: {
  lines?: number;
  category?: string;
}): Promise<{
  success: boolean;
  logs?: GeminiLogEntry[];
  count?: number;
  filesRead?: number;
  error?: string;
}> {
  const maxLines = Math.min(args.lines || 20, config.maxLogLines);
  const filterCategory = args.category;

  try {
    logger.debug(`Reading Gemini logs from: ${config.geminiLogsDir}`);

    // Check if logs directory exists
    try {
      await fs.access(config.geminiLogsDir);
    } catch {
      return {
        success: false,
        error: `Logs directory not found: ${config.geminiLogsDir}`,
      };
    }

    // Read directory and filter log files
    const files = await fs.readdir(config.geminiLogsDir);
    const logFiles = files
      .filter((f) => f.startsWith('gemini-logs-') && f.endsWith('.json'))
      .sort()
      .reverse() // Most recent first
      .slice(0, config.maxLogFiles);

    if (logFiles.length === 0) {
      return {
        success: false,
        error: 'No log files found',
      };
    }

    logger.debug(`Found ${logFiles.length} log files`);

    // Read and parse log files
    const allLogs: GeminiLogEntry[] = [];

    for (const filename of logFiles) {
      const filepath = path.join(config.geminiLogsDir, filename);

      try {
        const content = await fs.readFile(filepath, 'utf-8');
        const data: LogFile = JSON.parse(content);

        if (data.logs && Array.isArray(data.logs)) {
          allLogs.push(...data.logs);
        }
      } catch (err) {
        logger.warn(`Failed to read log file ${filename}:`, err);
        continue;
      }

      // Stop if we have enough logs
      if (allLogs.length >= maxLines * 2) {
        break;
      }
    }

    // Sort by timestamp (most recent first)
    allLogs.sort((a, b) => {
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });

    // Filter by category if specified
    let filteredLogs = allLogs;
    if (filterCategory) {
      filteredLogs = allLogs.filter((log) => log.category === filterCategory);
      logger.debug(`Filtered to ${filteredLogs.length} logs with category: ${filterCategory}`);
    }

    // Return last N entries
    const resultLogs = filteredLogs.slice(0, maxLines);

    return {
      success: true,
      logs: resultLogs,
      count: resultLogs.length,
      filesRead: logFiles.length,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Error reading Gemini logs:', errorMsg);

    return {
      success: false,
      error: errorMsg,
    };
  }
}
