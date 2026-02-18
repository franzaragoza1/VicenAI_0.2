import path from 'path';
import os from 'os';

export const config = {
  serverBaseUrl: process.env.VICEN_SERVER_URL || 'http://localhost:8081',
  geminiLogsDir: path.join(os.homedir(), 'AppData', 'Roaming', 'vicen-racing-engineer', 'gemini-logs'),
  logLevel: (process.env.LOG_LEVEL || 'info') as 'debug' | 'info' | 'warn' | 'error',
  maxLogLines: 100,
  maxLogFiles: 5,
};
