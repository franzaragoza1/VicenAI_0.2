/**
 * Overlay Preload Script
 * =======================
 * 
 * Exposes IPC methods to the overlay window for dragging functionality.
 * This is needed because frameless windows don't support -webkit-app-region: drag properly.
 */

const { contextBridge, ipcRenderer } = require('electron');

// Expose safe IPC methods to the renderer process
contextBridge.exposeInMainWorld('electronOverlay', {
  /**
   * Move the overlay window by delta coordinates
   * @param {number} deltaX - Horizontal movement in pixels
   * @param {number} deltaY - Vertical movement in pixels
   */
  moveWindow: (deltaX, deltaY) => {
    ipcRenderer.send('overlay-move', { mouseX: deltaX, mouseY: deltaY });
  },
  /**
   * Temporarily enable mouse events so the overlay can be dragged.
   */
  startDrag: () => {
    ipcRenderer.send('overlay-drag-start');
  },
  /**
   * Restore mouse transparency after dragging.
   */
  endDrag: () => {
    ipcRenderer.send('overlay-drag-end');
  }
});

console.log('[Overlay Preload] IPC bridge ready');
