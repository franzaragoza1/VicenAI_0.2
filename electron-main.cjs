const { app, BrowserWindow, Menu, ipcMain, globalShortcut } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

let mainWindow = null;
let overlayWindow = null;
let overlayInteractive = false;
let overlayInteractiveTimer = null;
let serverProcess = null;
// OPTIMIZACIÓN: Eliminado keepOnTopInterval - ahora usamos eventos en lugar de polling

// Detección de entorno
const isDev = !app.isPackaged;
const SERVER_PORT = 8081;
const FRONTEND_URL = isDev ? 'http://localhost:3000' : `http://localhost:${SERVER_PORT}`;
const OVERLAY_URL = isDev ? 'http://localhost:3000/overlay.html' : `http://localhost:${SERVER_PORT}/overlay.html`;

console.log(`[Electron] Environment: ${isDev ? 'DEVELOPMENT' : 'PRODUCTION'}`);
console.log(`[Electron] App path: ${app.getAppPath()}`);
console.log(`[Electron] Resources path: ${process.resourcesPath}`);

/**
 * Función para hacer ping al servidor backend
 */
function checkServer(url, timeout = 1000) {
  return new Promise((resolve) => {
    const request = http.get(url, (res) => {
      resolve(res.statusCode === 200);
    });
    
    request.on('error', () => resolve(false));
    request.setTimeout(timeout, () => {
      request.destroy();
      resolve(false);
    });
  });
}

/**
 * Espera activa: Hace ping hasta que el servidor responda
 */
async function waitForServer(maxAttempts = 30) {
  console.log(`[Electron] Waiting for backend at http://localhost:${SERVER_PORT}...`);
  
  for (let i = 0; i < maxAttempts; i++) {
    const isReady = await checkServer(`http://localhost:${SERVER_PORT}/api/health`);
    if (isReady) {
      console.log(`[Electron] Backend ready after ${i + 1} attempts`);
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.error('[Electron] Backend failed to start after 30 seconds');
  return false;
}

/**
 * Inicia el servidor Node.js backend
 */
function startBackendServer() {
  if (isDev) {
    console.log('[Electron] DEV mode: Assuming backend runs via npm script');
    return null; // En dev, concurrently ya maneja el backend
  }
  
  // PRODUCCIÓN: Localizar el servidor compilado
  let serverScriptPath;
  
  // Intentar primero dentro de app.asar (empaquetado)
  if (app.isPackaged) {
    // Ruta dentro del ASAR
    serverScriptPath = path.join(process.resourcesPath, 'app.asar', 'server', 'dist', 'index.js');
    
    // Si no existe, probar fuera del ASAR (asarUnpack)
    if (!require('fs').existsSync(serverScriptPath)) {
      serverScriptPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'server', 'dist', 'index.js');
    }
    
    // Última opción: dentro de la carpeta de app sin ASAR
    if (!require('fs').existsSync(serverScriptPath)) {
      serverScriptPath = path.join(app.getAppPath(), 'server', 'dist', 'index.js');
    }
  } else {
    // Desarrollo local sin empaquetar
    serverScriptPath = path.join(app.getAppPath(), 'server', 'dist', 'index.js');
  }
  
  console.log(`[Electron] Starting backend from: ${serverScriptPath}`);
  
  if (!require('fs').existsSync(serverScriptPath)) {
    console.error('[Electron] ERROR: Backend script not found!');
    console.error(`[Electron] Searched at: ${serverScriptPath}`);
    return null;
  }
  
  // Usar el ejecutable de Electron como Node.js
  // ELECTRON_RUN_AS_NODE=1 hace que Electron actúe como Node puro
  const nodePath = isDev ? 'node' : process.execPath;
  
  console.log(`[Electron] Using Node.js/Electron from: ${nodePath}`);
  
  // Spawn Node.js con el servidor
  const spawnEnv = isDev 
    ? process.env 
    : { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  
  const nodeProcess = spawn(nodePath, [serverScriptPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: path.dirname(serverScriptPath),
    env: spawnEnv
  });
  
  nodeProcess.stdout.on('data', (data) => {
    console.log(`[Backend] ${data.toString().trim()}`);
  });
  
  nodeProcess.stderr.on('data', (data) => {
    console.error(`[Backend ERROR] ${data.toString().trim()}`);
  });
  
  nodeProcess.on('close', (code) => {
    console.log(`[Backend] Process exited with code ${code}`);
    if (code !== 0 && code !== null) {
      console.error('[Backend] Crashed unexpectedly!');
    }
  });
  
  nodeProcess.on('error', (err) => {
    console.error('[Backend] Failed to start:', err);
  });
  
  return nodeProcess;
}

// ============================================================================
// IPC HANDLERS - Registrados globalmente antes de crear ventanas
// ============================================================================

// ✅ IPC handler para mover la ventana overlay
ipcMain.on('overlay-move', (event, { mouseX, mouseY }) => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    const [currentX, currentY] = overlayWindow.getPosition();
    overlayWindow.setPosition(
      Math.round(currentX + mouseX),
      Math.round(currentY + mouseY)
    );
  }
});

// Enable mouse events while dragging overlay
ipcMain.on('overlay-drag-start', () => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setIgnoreMouseEvents(false);
  }
});

// Restore mouse transparency after dragging
ipcMain.on('overlay-drag-end', () => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  }
});

// ✅ IPC handler para guardar logs de Gemini
ipcMain.handle('save-gemini-logs', async (event, logsData) => {
  const fs = require('fs');
  const logsDir = path.join(app.getPath('userData'), 'gemini-logs');
  
  // Crear directorio si no existe
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
    console.log(`[Electron] Created logs directory: ${logsDir}`);
  }
  
  // Generar nombre de archivo con timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const filename = `gemini-logs-${timestamp}.json`;
  const filepath = path.join(logsDir, filename);
  
  try {
    // Guardar con formato legible
    fs.writeFileSync(filepath, JSON.stringify(logsData, null, 2), 'utf8');
    console.log(`[Electron] Gemini logs saved: ${filepath} (${logsData.logs?.length || 0} entries)`);
    return filepath;
  } catch (error) {
    console.error(`[Electron] Failed to save Gemini logs:`, error);
    throw error;
  }
});

// ✅ IPC handler para obtener directorio de logs
ipcMain.handle('get-logs-directory', async () => {
  return path.join(app.getPath('userData'), 'gemini-logs');
});

console.log('[Electron] IPC handlers registered (overlay-move, save-gemini-logs, get-logs-directory)');

// ============================================================================
// WINDOW CREATION FUNCTIONS
// ============================================================================

/**
 * Crear la ventana principal de Electron
 */
function createWindow() {
  // Ocultar el menú predeterminado
  Menu.setApplicationMenu(null);
  
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    autoHideMenuBar: true, // Oculta la barra de menú
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      devTools: true, // Permitir DevTools para debugging
      preload: path.join(__dirname, 'main-preload.cjs'), // IPC para Gemini logs
      webSecurity: false, // Permitir acceso a recursos locales de audio
      allowRunningInsecureContent: true, // Permitir contenido inseguro para audio local
      experimentalFeatures: true // Habilitar características experimentales de audio
    },
    icon: path.join(__dirname, 'assets', 'favicon.ico') // Opcional
  });
  
  mainWindow.loadURL(FRONTEND_URL);
  
  // Abrir DevTools automáticamente en DEV
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }
  
  mainWindow.on('closed', () => {
    mainWindow = null;
    // Also close overlay when main window closes
    if (overlayWindow) {
      overlayWindow.close();
    }
  });
  
  console.log(`[Electron] Window created, loading: ${FRONTEND_URL}`);
}

/**
 * Crear la ventana overlay flotante
 */
function createOverlayWindow() {
  overlayWindow = new BrowserWindow({
    width: 140,
    height: 160,
    frame: false,           // Sin bordes
    transparent: true,      // Fondo transparente
    alwaysOnTop: true,      // Siempre visible
    skipTaskbar: true,      // No aparece en taskbar
    resizable: false,
    hasShadow: false,
    focusable: false,       // No roba foco del sim
    type: 'toolbar',        // ✅ NUEVO: Tipo de ventana especial para overlay
    minimizable: false,     // ✅ NUEVO: No minimizable
    maximizable: false,     // ✅ NUEVO: No maximizable
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false, // ✅ NUEVO: No throttle cuando está oculto
      preload: path.join(__dirname, 'overlay-preload.cjs') // ✅ NUEVO: Preload para IPC
    }
  });
  
  // Posición inicial: esquina superior derecha
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width } = primaryDisplay.workAreaSize;
  overlayWindow.setPosition(width - 160, 20);
  
  overlayWindow.loadURL(OVERLAY_URL);
  
  // ✅ NUEVO: Always-on-top con nivel 'screen-saver' (necesario para fullscreen)
  // Combinado con setIgnoreMouseEvents para que el ratón pase al simulador
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  
  // 🔧 FIX: Ignorar eventos del ratón para que pasen al simulador
  // forward: true permite que los clicks pasen a través del overlay
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayInteractive = false;
  
  // ✅ NUEVO: Visible en fullscreen
  overlayWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true
  });
  
  // ✅ OPTIMIZACIÓN: Eliminado setInterval - usar solo eventos para re-elevar
  // El polling cada 2s causaba overhead innecesario y posibles stutters
  
  // ✅ Re-elevar cuando pierde foco (evento, no polling)
  overlayWindow.on('blur', () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      // Re-elevar inmediatamente sin setTimeout para respuesta más rápida
      overlayWindow.setAlwaysOnTop(true, 'screen-saver');
      overlayWindow.moveTop();
    }
  });
  
  // ✅ Re-elevar cuando se muestra
  overlayWindow.on('show', () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.setAlwaysOnTop(true, 'screen-saver');
      overlayWindow.moveTop();
    }
  });
  
  // ✅ Re-elevar cuando se restaura de minimizado
  overlayWindow.on('restore', () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.setAlwaysOnTop(true, 'screen-saver');
      overlayWindow.moveTop();
    }
  });
  
  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });
  
  console.log(`[Electron] Overlay window created with screen-saver level (mouse-transparent), loading: ${OVERLAY_URL}`);
}

/**
 * Toggle overlay visibility
 */
function toggleOverlay() {
  if (!overlayWindow) {
    createOverlayWindow();
    console.log('[Electron] Overlay: CREATED & VISIBLE (screen-saver level, mouse-transparent)');
  } else if (overlayWindow.isVisible()) {
    overlayWindow.hide();
    console.log('[Electron] Overlay: HIDDEN');
  } else {
    overlayWindow.show();
    // ✅ NUEVO: Re-aplicar always-on-top al mostrar
    overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    overlayWindow.moveTop();
    console.log('[Electron] Overlay: VISIBLE (screen-saver level, mouse-transparent)');
  }
}

function setOverlayInteractive(enabled) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  overlayInteractive = enabled;
  if (overlayInteractiveTimer) {
    clearTimeout(overlayInteractiveTimer);
    overlayInteractiveTimer = null;
  }
  if (enabled) {
    overlayWindow.setIgnoreMouseEvents(false);
    console.log('[Electron] Overlay interaction ENABLED (mouse active)');
    // Auto-disable after 8s to avoid blocking the sim
    overlayInteractiveTimer = setTimeout(() => {
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.setIgnoreMouseEvents(true, { forward: true });
        overlayInteractive = false;
        console.log('[Electron] Overlay interaction auto-disabled (mouse transparent)');
      }
    }, 8000);
  } else {
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });
    console.log('[Electron] Overlay interaction DISABLED (mouse transparent)');
  }
}

/**
 * Secuencia de inicio de la aplicación
 */

/**
 * OPTIMIZATION: GPU Configuration for SimRacing
 *
 * Option 1: Full disable (current) - Safest, uses CPU rendering
 *   app.disableHardwareAcceleration();
 *
 * Option 2: Selective disable - Only disable GPU compositing
 *   app.commandLine.appendSwitch('disable-gpu-compositing');
 *
 * Option 3: Software rendering only
 *   app.commandLine.appendSwitch('disable-gpu');
 *   app.commandLine.appendSwitch('disable-software-rasterizer');
 *
 * For SimRacing, we use Option 1 (full disable) to:
 * - Prevent GPU resource competition with iRacing/ACC
 * - Avoid TDR (Timeout Detection and Recovery) crashes
 * - Reduce overall system load during racing
 *
 * If you experience UI stutters but have a powerful GPU, try Option 2.
 */

// OPTIMIZATION: Use environment variable to allow testing different modes
const GPU_MODE = process.env.VICEN_GPU_MODE || 'disabled';

switch (GPU_MODE) {
  case 'compositing-only':
    // Option 2: Only disable compositing (lighter touch)
    app.commandLine.appendSwitch('disable-gpu-compositing');
    console.log('[Electron] ⚡ GPU compositing DISABLED (hybrid mode)');
    break;
  case 'software':
    // Option 3: Full software rendering
    app.commandLine.appendSwitch('disable-gpu');
    app.commandLine.appendSwitch('disable-software-rasterizer');
    console.log('[Electron] ⚡ GPU DISABLED + software rasterizer (full software mode)');
    break;
  case 'enabled':
    // Option 4: Full GPU (for testing)
    console.log('[Electron] ⚡ GPU ENABLED (testing mode - may cause issues with sims)');
    break;
  case 'disabled':
  default:
    // Option 1: Full disable (safest for SimRacing)
    app.disableHardwareAcceleration();
    console.log('[Electron] ⚡ Hardware acceleration DISABLED (performance mode)');
    break;
}

app.whenReady().then(async () => {
  console.log('[Electron] App ready, starting initialization...');
  
  // 1. Iniciar servidor backend (solo en PROD)
  if (!isDev) {
    serverProcess = startBackendServer();
    if (!serverProcess) {
      console.error('[Electron] Failed to start backend server!');
      app.quit();
      return;
    }
  }
  
  // 2. Esperar a que el servidor esté listo
  const serverReady = await waitForServer();
  if (!serverReady) {
    console.error('[Electron] Backend not responding, aborting...');
    app.quit();
    return;
  }
  
  // 3. Crear ventana principal
  createWindow();
  
  // 4. NO crear overlay automáticamente - se abre con F10
  console.log('[Electron] 💡 Press F10 to toggle overlay | F11 to force overlay to top');
  
  // 5. Registrar shortcuts globales
  // F10 = Toggle Overlay (F12 lo usa DevTools)
  globalShortcut.register('F10', () => {
    toggleOverlay();
  });
  
  // Ctrl+Shift+O = Toggle Overlay (alternativo)
  globalShortcut.register('CommandOrControl+Shift+O', () => {
    toggleOverlay();
  });
  
  // ✅ NUEVO: F11 = Forzar overlay al frente (útil si se oculta detrás del sim)
  globalShortcut.register('F11', () => {
    if (overlayWindow && overlayWindow.isVisible()) {
      overlayWindow.setAlwaysOnTop(true, 'screen-saver');
      overlayWindow.moveTop();
      console.log('[Electron] Overlay forced to top (screen-saver level, mouse-transparent)');
    } else {
      console.log('[Electron] Overlay not visible, use F10 to show it first');
    }
  });

  // F9 = Enable overlay interaction briefly (drag window)
  globalShortcut.register('F9', () => {
    if (overlayWindow && overlayWindow.isVisible()) {
      setOverlayInteractive(true);
    } else {
      console.log('[Electron] Overlay not visible, use F10 to show it first');
    }
  });
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

/**
 * OPTIMIZATION: Process Priority Management for SimRacing
 *
 * When the user switches to iRacing/ACC, we lower Electron's process priority
 * to give more CPU time to the simulator. When they return to VICEN, we restore it.
 *
 * Windows priority levels (wmic):
 * - "realtime" (24) - Dangerous, can freeze system
 * - "high" (13) - Above normal
 * - "above normal" (10) - Slightly elevated
 * - "normal" (8) - Default
 * - "below normal" (6) - Background tasks
 * - "idle" (4) - Lowest priority
 *
 * We use "below normal" when unfocused to be a good citizen while racing.
 */
const { exec } = require('child_process'); // Note: spawn already imported at top

let currentPriority = 'normal';

function setProcessPriority(priority) {
  if (process.platform !== 'win32') {
    // Only Windows supports wmic priority changes
    return;
  }
  
  if (currentPriority === priority) {
    return; // Already at this priority
  }
  
  const priorityMap = {
    'normal': 32,      // NORMAL_PRIORITY_CLASS
    'below normal': 16384, // BELOW_NORMAL_PRIORITY_CLASS
    'idle': 64         // IDLE_PRIORITY_CLASS
  };
  
  const priorityValue = priorityMap[priority] || 32;
  
  // Use PowerShell for more reliable priority setting
  const cmd = `powershell -Command "(Get-Process -Id ${process.pid}).PriorityClass = ${priorityValue}"`;
  
  exec(cmd, (error) => {
    if (error) {
      // Fallback to wmic if PowerShell fails
      const wmicCmd = `wmic process where processid=${process.pid} CALL setpriority "${priority}"`;
      exec(wmicCmd, (wmicError) => {
        if (wmicError) {
          console.log(`[Electron] ⚠️ Could not set process priority: ${wmicError.message}`);
        } else {
          currentPriority = priority;
          console.log(`[Electron] ⚡ Process priority set to: ${priority}`);
        }
      });
    } else {
      currentPriority = priority;
      console.log(`[Electron] ⚡ Process priority set to: ${priority}`);
    }
  });
}

// Lower priority when main window loses focus (user likely in sim)
app.on('browser-window-blur', () => {
  // Only lower priority if BOTH windows are unfocused
  const allWindows = BrowserWindow.getAllWindows();
  const anyFocused = allWindows.some(win => win.isFocused());
  
  if (!anyFocused) {
    setProcessPriority('below normal');
  }
});

// Restore priority when any window gains focus
app.on('browser-window-focus', () => {
  setProcessPriority('normal');
});

/**
 * Limpieza al cerrar la aplicación
 */
app.on('window-all-closed', () => {
  // Unregister shortcuts
  globalShortcut.unregisterAll();
  
  // Matar el proceso del servidor
  if (serverProcess) {
    console.log('[Electron] Killing backend process...');
    serverProcess.kill('SIGTERM');
    
    // Forzar kill después de 3 segundos si no se cierra
    setTimeout(() => {
      if (!serverProcess.killed) {
        console.log('[Electron] Force killing backend...');
        serverProcess.kill('SIGKILL');
      }
    }, 3000);
  }
  
  // Cerrar app en todas las plataformas (no solo macOS)
  app.quit();
});

app.on('before-quit', () => {
  globalShortcut.unregisterAll();
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
  }
});
