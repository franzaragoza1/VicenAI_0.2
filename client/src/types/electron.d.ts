/**
 * Type definitions for Electron IPC API
 * Exposed via preload script to the renderer process
 */

export interface ElectronAPI {
  saveGeminiLogs: (logsData: {
    sessionInfo: {
      instanceId: number;
      startTime: number;
      totalConnections: number;
      totalDisconnections: number;
      totalErrors: number;
    };
    summary: {
      total: number;
      sent: number;
      received: number;
      errors: number;
      tools: number;
      events: number;
    };
    logs: Array<{
      timestamp: string;
      type: 'sent' | 'received' | 'error' | 'tool' | 'event';
      category: string;
      content: string;
      metadata?: Record<string, any>;
    }>;
  }) => Promise<string>;
  
  getLogsDirectory: () => Promise<string>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
