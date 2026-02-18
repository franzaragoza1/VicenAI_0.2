/**
 * PTT via Global Keyboard Hook
 * Funciona con CUALQUIER tecla, configurada desde SimHub/Fanatec/etc
 * Soporta modo HOLD (mantener) y TOGGLE (pulsar para activar/desactivar)
 *
 * OPTIMIZATION:
 * - Lazy initialization of uIOhook (only starts when needed)
 * - Throttling to reduce CPU overhead
 * - Proper cleanup on stop
 */

import { uIOhook, UiohookKey } from 'uiohook-napi';

export type PTTMode = 'hold' | 'toggle';

export interface PTTKeyboardConfig {
  key: number;        // Código de tecla (UiohookKey.F13, etc)
  keyName?: string;   // Nombre para logs
  mode: PTTMode;      // 'hold' = mantener, 'toggle' = pulsar
}

export interface PTTEventCallback {
  onPress: () => void;
  onRelease: () => void;
}

// OPTIMIZATION: Throttle interval for event processing
const PTT_THROTTLE_MS = 50; // Minimum 50ms between processed events

// Mapeo de nombres a códigos de tecla
export const KEY_CODES: Record<string, number> = {
  // F-keys extendidas (ideales para PTT - no interfieren con nada)
  'F13': UiohookKey.F13,
  'F14': UiohookKey.F14,
  'F15': UiohookKey.F15,
  'F16': UiohookKey.F16,
  'F17': UiohookKey.F17,
  'F18': UiohookKey.F18,
  'F19': UiohookKey.F19,
  'F20': UiohookKey.F20,
  'F21': UiohookKey.F21,
  'F22': UiohookKey.F22,
  'F23': UiohookKey.F23,
  'F24': UiohookKey.F24,
  
  // F-keys normales (por si acaso)
  'F1': UiohookKey.F1,
  'F2': UiohookKey.F2,
  'F3': UiohookKey.F3,
  'F4': UiohookKey.F4,
  'F5': UiohookKey.F5,
  'F6': UiohookKey.F6,
  'F7': UiohookKey.F7,
  'F8': UiohookKey.F8,
  'F9': UiohookKey.F9,
  'F10': UiohookKey.F10,
  'F11': UiohookKey.F11,
  'F12': UiohookKey.F12,
  
  // Otras teclas útiles
  'ScrollLock': UiohookKey.ScrollLock,
  'Insert': UiohookKey.Insert,
  'Home': UiohookKey.Home,
  'End': UiohookKey.End,
  'PageUp': UiohookKey.PageUp,
  'PageDown': UiohookKey.PageDown,
  
  // Numpad
  'Numpad0': UiohookKey.Numpad0,
  'Numpad1': UiohookKey.Numpad1,
  'Numpad2': UiohookKey.Numpad2,
  'Numpad3': UiohookKey.Numpad3,
  'Numpad4': UiohookKey.Numpad4,
  'Numpad5': UiohookKey.Numpad5,
  'Numpad6': UiohookKey.Numpad6,
  'Numpad7': UiohookKey.Numpad7,
  'Numpad8': UiohookKey.Numpad8,
  'Numpad9': UiohookKey.Numpad9,
  'NumpadAdd': UiohookKey.NumpadAdd,
  'NumpadSubtract': UiohookKey.NumpadSubtract,
  'NumpadMultiply': UiohookKey.NumpadMultiply,
  'NumpadDivide': UiohookKey.NumpadDivide,
  'NumpadEnter': UiohookKey.NumpadEnter,
  
  // Letras (por si quieres usar alguna)
  'V': UiohookKey.V,
  'P': UiohookKey.P,
  'T': UiohookKey.T,
};

export class PTTKeyboardService {
  private config: PTTKeyboardConfig | null = null;
  private callbacks: PTTEventCallback | null = null;
  private isRunning = false;
  private isPressed = false;        // Estado físico de la tecla (keydown)
  private isToggleActive = false;   // Estado lógico en modo toggle
  private hookInitialized = false;  // OPTIMIZATION: Track if hook is initialized
  
  // 🆕 Debounce y estadísticas
  private lastPressTime = 0;
  private lastReleaseTime = 0;
  private lastEventTime = 0;        // OPTIMIZATION: Global throttle
  private eventCount = 0;
  private filteredCount = 0;
  private throttledCount = 0;       // OPTIMIZATION: Track throttled events
  private readonly DEBOUNCE_MS = 100; // 100ms debounce en servidor

  /**
   * Obtiene la lista de teclas disponibles
   */
  public getAvailableKeys(): string[] {
    return Object.keys(KEY_CODES);
  }

  /**
   * Configura la tecla PTT
   */
  public configure(keyName: string, mode: PTTMode = 'toggle'): boolean {
    const keyCode = KEY_CODES[keyName];
    if (!keyCode) {
      console.error(`[PTT-Keyboard] Tecla desconocida: ${keyName}`);
      console.log(`[PTT-Keyboard] Teclas disponibles: ${Object.keys(KEY_CODES).join(', ')}`);
      return false;
    }
    
    this.config = {
      key: keyCode,
      keyName: keyName,
      mode: mode
    };
    
    // Reset stats
    this.eventCount = 0;
    this.filteredCount = 0;
    this.isToggleActive = false;
    
    console.log(`[PTT-Keyboard] Configurado: ${keyName} (código ${keyCode}) - Modo: ${mode.toUpperCase()}`);
    return true;
  }

  /**
   * Inicia la escucha global de teclas
   * OPTIMIZATION: Lazy initialization - hook only starts when needed
   */
  public start(callbacks: PTTEventCallback): boolean {
    if (!this.config) {
      console.error('[PTT-Keyboard] No hay configuración. Usa configure() primero.');
      return false;
    }

    if (this.isRunning) {
      console.log('[PTT-Keyboard] Ya está corriendo');
      return true;
    }

    this.callbacks = callbacks;
    const mode = this.config.mode;
    
    // OPTIMIZATION: Only setup listeners once (lazy initialization)
    if (!this.hookInitialized) {
      this.setupHookListeners();
      this.hookInitialized = true;
    }

    // Iniciar hook global
    try {
      uIOhook.start();
      this.isRunning = true;
      console.log(`[PTT-Keyboard] ✅ Escuchando tecla ${this.config.keyName} - Modo: ${mode.toUpperCase()}`);
      return true;
    } catch (error: any) {
      console.error('[PTT-Keyboard] Error iniciando hook:', error.message);
      return false;
    }
  }

  /**
   * OPTIMIZATION: Setup hook listeners with throttling
   * Separated from start() for lazy initialization
   */
  private setupHookListeners(): void {
    const mode = this.config?.mode;
    
    // Configurar listeners con debounce y throttle
    uIOhook.on('keydown', (e) => {
      // OPTIMIZATION: Early exit for non-matching keys (most common case)
      if (e.keycode !== this.config?.key) return;
      
      const now = Date.now();
      this.eventCount++;
      
      // OPTIMIZATION: Global throttle - ignore events too close together
      if (now - this.lastEventTime < PTT_THROTTLE_MS) {
        this.throttledCount++;
        return;
      }
      this.lastEventTime = now;
      
      // 🔒 DEBOUNCE: Ignorar si ya está presionado físicamente o si es muy seguido
      if (this.isPressed || (now - this.lastPressTime < this.DEBOUNCE_MS)) {
        this.filteredCount++;
        return;
      }
      
      this.isPressed = true;
      this.lastPressTime = now;
      
      if (this.config?.mode === 'toggle') {
        // TOGGLE MODE: Cambiar estado en keydown
        this.isToggleActive = !this.isToggleActive;
        console.log(`[PTT-Keyboard] 🎙️ ${this.config.keyName} TOGGLE → ${this.isToggleActive ? 'ON' : 'OFF'}`);
        
        if (this.isToggleActive) {
          this.callbacks?.onPress();
        } else {
          this.callbacks?.onRelease();
        }
      } else {
        // HOLD MODE: Activar en keydown
        console.log(`[PTT-Keyboard] 🎙️ ${this.config?.keyName} PRESS (hold mode)`);
        this.callbacks?.onPress();
      }
    });

    uIOhook.on('keyup', (e) => {
      // OPTIMIZATION: Early exit for non-matching keys
      if (e.keycode !== this.config?.key) return;
      
      const now = Date.now();
      this.eventCount++;
      
      // OPTIMIZATION: Global throttle
      if (now - this.lastEventTime < PTT_THROTTLE_MS) {
        this.throttledCount++;
        return;
      }
      this.lastEventTime = now;
      
      // 🔒 DEBOUNCE: Ignorar si no está presionado o si es muy seguido
      if (!this.isPressed || (now - this.lastReleaseTime < this.DEBOUNCE_MS)) {
        this.filteredCount++;
        return;
      }
      
      this.isPressed = false;
      this.lastReleaseTime = now;
      
      if (this.config?.mode === 'hold') {
        // HOLD MODE: Desactivar en keyup
        console.log(`[PTT-Keyboard] 🔇 ${this.config.keyName} RELEASE (hold mode)`);
        this.callbacks?.onRelease();
      }
      // TOGGLE MODE: No hacer nada en keyup (ya se manejó en keydown)
    });
    
    console.log('[PTT-Keyboard] 🔧 Hook listeners initialized with throttling');
  }

  /**
   * Detiene la escucha
   */
  public stop(): void {
    if (this.isRunning) {
      uIOhook.stop();
      this.isRunning = false;
      this.isPressed = false;
      this.isToggleActive = false;
      console.log('[PTT-Keyboard] Detenido');
    }
  }

  /**
   * Devuelve si el PTT está activo (considera modo toggle)
   */
  public isPTTActive(): boolean {
    if (this.config?.mode === 'toggle') {
      return this.isToggleActive;
    }
    return this.isPressed;
  }

  /**
   * Devuelve si está activo
   */
  public isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Devuelve info de configuración actual
   * OPTIMIZATION: Added throttled count to stats
   */
  public getInfo(): { keyName: string | null; mode: PTTMode | null; isActive: boolean; isPTTOn: boolean; stats: { total: number; filtered: number; throttled: number } } {
    return {
      keyName: this.config?.keyName || null,
      mode: this.config?.mode || null,
      isActive: this.isRunning,
      isPTTOn: this.isPTTActive(),
      stats: {
        total: this.eventCount,
        filtered: this.filteredCount,
        throttled: this.throttledCount
      }
    };
  }
}

// Singleton
export const pttKeyboardService = new PTTKeyboardService();
