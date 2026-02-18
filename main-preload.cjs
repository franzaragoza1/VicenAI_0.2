/**
 * Main Window Preload Script
 * ===========================
 * 
 * Exposes IPC methods for Gemini Live logging.
 * Allows the renderer to save logs to disk automatically.
 */

const { contextBridge, ipcRenderer } = require('electron');

// Expose safe IPC methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Save Gemini logs to a JSON file in userData/gemini-logs/
   * @param {Object} logsData - The logs data object to save
   * @returns {Promise<string>} Path to the saved file
   */
  saveGeminiLogs: async (logsData) => {
    return await ipcRenderer.invoke('save-gemini-logs', logsData);
  },

  /**
   * Get the path where logs are being saved
   * @returns {Promise<string>} Directory path for logs
   */
  getLogsDirectory: async () => {
    return await ipcRenderer.invoke('get-logs-directory');
  }
});

console.log('[Main Preload] IPC bridge ready (Gemini logs)');
