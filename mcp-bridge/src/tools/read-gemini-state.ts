import { httpClient } from '../data-sources/http-client.js';
import { logger } from '../utils/logger.js';
import { readGeminiLogs } from './read-gemini-logs.js';

export const readGeminiStateTool = {
  name: 'read_gemini_state',
  description: 'Gets current Gemini Live state (connected, speaking, last transcript). Fetches from real-time endpoint or falls back to logs.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
};

export async function readGeminiState(): Promise<{
  success: boolean;
  state?: {
    connected: boolean;
    speaking: boolean;
    lastTranscript: string | null;
    lastUpdate: number;
  };
  source?: string;
  error?: string;
}> {
  try {
    logger.debug('Fetching Gemini state');

    // Try to fetch from real-time endpoint first
    const response = await httpClient.get('/api/gemini/state');

    if (response.success && response.data?.state) {
      logger.debug('Fetched Gemini state from endpoint');
      return {
        success: true,
        state: response.data.state,
        source: 'endpoint',
      };
    }

    // Fallback: Read from logs
    logger.debug('Endpoint failed, falling back to logs');

    const logsResult = await readGeminiLogs({ lines: 10 });

    if (!logsResult.success || !logsResult.logs || logsResult.logs.length === 0) {
      return {
        success: false,
        error: 'Unable to fetch state from endpoint or logs',
      };
    }

    // Try to infer state from recent logs
    const recentLogs = logsResult.logs;

    // Look for connection/disconnection events
    let connected = false;
    let speaking = false;
    let lastTranscript: string | null = null;

    for (const log of recentLogs) {
      // Check for connection events
      if (log.category === 'connection' || log.type === 'event') {
        if (log.content.includes('connect') && !log.content.includes('disconnect')) {
          connected = true;
        } else if (log.content.includes('disconnect')) {
          connected = false;
        }
      }

      // Check for speech/audio events
      if (log.category === 'audio' || log.category === 'speech') {
        if (log.content.includes('speaking') || log.content.includes('start')) {
          speaking = true;
        } else if (log.content.includes('stop') || log.content.includes('end')) {
          speaking = false;
        }
      }

      // Get last transcript
      if ((log.category === 'response' || log.category === 'user_message') && !lastTranscript) {
        lastTranscript = log.content;
      }
    }

    const inferredState = {
      connected,
      speaking,
      lastTranscript,
      lastUpdate: recentLogs[0] ? new Date(recentLogs[0].timestamp).getTime() : Date.now(),
    };

    logger.debug('Inferred Gemini state from logs');

    return {
      success: true,
      state: inferredState,
      source: 'logs',
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Error reading Gemini state:', errorMsg);

    return {
      success: false,
      error: errorMsg,
    };
  }
}
