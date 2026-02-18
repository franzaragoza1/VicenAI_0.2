  import {
    LiveServerMessage,
    FunctionDeclaration,
    Type,
  } from "@google/genai";
  import {
    TelemetryData,
    SessionContext,
    CompetitionContext,
    FullTelemetry,
    formatLapTime,
    SimHubTelemetry,
  } from "../types/telemetry.types";
  import {
    createCompetitionContext,
    createFullTelemetry,
    createSessionContext,
    formatTimeForGemini,
  } from "../utils/telemetry.utils";
  import {
    sanitizeTelemetry,
    formatSanitized,
    formatPosition,
    formatLap,
    formatFuelPercent,
    formatFuelAmount,
    canSendSessionJoined,
    type SanitizedTelemetry,
  } from "../utils/telemetry-sanitizer";
  import { lapComparison } from "./lap-comparison";
import {
  buildSystemInstruction,
  GeminiInitialContext,
} from "./gemini-system-instruction";
import {
  getMyStanding,
  getMyClassName,
  getClassStandings,
  getClassLeader,
  formatStandingsTableForGemini,
} from "../utils/multiclass.utils";

  // Types for callbacks
  type AudioCallback = (active: boolean) => void;
  type TranscriptCallback = (text: string, isFinal: boolean) => void;
  type ToolCallback = () => any;

  // 📝 Debug Logging Types
  interface GeminiLogEntry {
    timestamp: string;
    type: 'sent' | 'received' | 'error' | 'tool' | 'event';
    category: string;  // 'user_message', 'context', 'proactive_event', 'tool_call', 'response', etc.
    content: string;
    metadata?: Record<string, any>;
  }

  interface SystemInstructionMeta {
    hash: string;
    length: number;
    origin: string;
    preview: string;
  }

  interface BridgeSessionConfig {
    model: string;
    ragEnabled: boolean;
    retrievalAttached: boolean;
    location: string;
    projectIdMasked: string;
  }

  /**
   * Tool Definition: get_session_context
   *
   * Datos de COMPETICIÓN para Gemini Live (timing, posición, gaps, TODOS LOS RIVALES).
   *
   * PROPÓSITO:
   * - Datos de carrera: tiempos, posición, gaps, sectores
   * - TABLA COMPLETA de clasificación con TODOS los rivales (nombres, iRating, SR, tiempos)
   * - Sin datos de física/mecánica (fuel, temperatura, rpm)
   *
   * RETORNA:
   * - timing: Tiempos (current, last, best, session best) con deltas y sectores
   * - race: Posición, gaps adelante/atrás, vueltas completadas/restantes
   * - session: Tipo de sesión, circuito, coche, flags, pit lane
   * - standings: ARRAY COMPLETO con TODOS los pilotos ordenados por posición
   *   - Cada entrada incluye: posición, nombre, #coche, iRating, Safety Rating,
   *     clase, última vuelta, mejor vuelta, incidentes, estado (activo/DNF)
   * - meta: Timestamp y validez
   *
   * EJEMPLOS DE USO:
   * - "¿Cómo fue la última vuelta?"
   * - "¿Cuál es mi mejor tiempo?"
   * - "¿Dónde estoy perdiendo tiempo?"
   * - "¿Qué posición tengo?"
   * - "¿Cuánto me falta para el líder?"
   * - "¿Quién está liderando?"
   * - "¿Quién va delante mío?"
   * - "¿Qué iRating tiene el líder?"
   * - "¿Cuántos incidentes tiene el que va segundo?"
   */
  const sessionContextTool: FunctionDeclaration = {
    name: "get_session_context",
    description:
      "Devuelve datos completos de carrera: tiempos de vuelta, análisis de sectores, posición, gaps, Y TABLA COMPLETA DE CLASIFICACIÓN con todos los pilotos (nombres, iRating, safety rating, tiempos, incidentes). Úsala cuando el piloto pregunte sobre rendimiento, posición, tiempos, o información sobre otros pilotos.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  };

  const vehicleSetupTool: FunctionDeclaration = {
    name: "get_vehicle_setup",
    description:
      "Devuelve los datos más recientes del setup del vehículo si están disponibles (iRacing vía IRSDK, LMU vía archivos de setup). Si no hay setup disponible, devuelve info básica del coche/circuito. Úsala cuando el piloto pregunte sobre setup del coche, ajustes de suspensión, presiones de neumáticos, o configuración mecánica.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  };

  const recentEventsTool: FunctionDeclaration = {
    name: "get_recent_events",
    description:
      "Devuelve los últimos 20 eventos de carrera que ocurrieron (gaps, daños, cambios de posición, tiempos de vuelta). Úsala cuando el piloto pregunte sobre eventos recientes, qué ha pasado hace poco, o para obtener contexto de la situación actual de la carrera.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  };

  const requestSetupTool: FunctionDeclaration = {
    name: "request_current_setup",
    description:
      "Solicita la instantánea MÁS RECIENTE del setup del coche desde el backend (iRacing o LMU). Úsala cuando el piloto pregunte sobre el setup actual, quiera analizar cambios de setup, o mencione ajustes de configuración.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  };

  /**
   * Tool Definition: compare_laps
   * 
   * Generates a visual telemetry comparison between two laps.
   * Shows Speed, Throttle, Brake, Gear, and Steering traces overlaid.
   * 
   * EJEMPLOS DE USO:
   * - "Compara mi última vuelta con la mejor"
   * - "¿Dónde estoy perdiendo tiempo?"
   * - "Analiza mis últimas dos vueltas"
   * - "¿Qué hice diferente en mi mejor vuelta?"
   * - "Compara la vuelta 15 con la 23"
   */
  const compareLapsTool: FunctionDeclaration = {
    name: "compare_laps",
    description:
      "Genera una imagen visual de comparación de telemetría entre dos vueltas y la analiza. Muestra trazas de Velocidad, Acelerador, Freno, Marcha, y Volante. Úsala cuando el piloto pida comparar vueltas, encontrar dónde pierde tiempo, o analizar su conducción. Referencias: 'session_best' (mejor vuelta), 'last' (última vuelta), o número de vuelta.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        lap1: {
          type: Type.STRING,
          description: "Referencia de primera vuelta: 'session_best', 'last', o número de vuelta. Default: 'session_best'",
        },
        lap2: {
          type: Type.STRING,
          description: "Referencia de segunda vuelta: 'session_best', 'last', o número de vuelta. Default: 'last'",
        },
      },
    },
  };

  /**
   * Tool Definition: configure_pit_stop
   * 
   * Configures the next pit stop in iRacing.
   * ONLY works when driver is in the car.
   * 
   * EJEMPLOS DE USO:
   * - "Pon 40 litros para la próxima parada"
   * - "Cambia solo las ruedas traseras"
   * - "Quiero reparación rápida"
   * - "Limpia el parabrisas"
   * - "Quita el combustible de la parada"
   */
  const configurePitStopTool: FunctionDeclaration = {
    name: "configure_pit_stop",
    description: `Configura la próxima parada en boxes en iRacing. SOLO funciona cuando el piloto está en el coche.
  Acciones: clear_all (resetear todo), add_fuel (establecer cantidad de combustible), change_tires (seleccionar qué neumáticos), fast_repair, windshield, clear_tires, clear_fuel.
  Ejemplos: "Pon 40 litros" → add_fuel con 40, "Cambia las 4 ruedas" → change_tires con all, "Solo traseras" → change_tires con rears.`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: "Acción: clear_all, add_fuel, change_tires, fast_repair, windshield, clear_tires, clear_fuel",
        },
        fuelAmount: {
          type: Type.NUMBER,
          description: "Litros a añadir (solo para acción add_fuel). 0 = usar cantidad existente.",
        },
        tires: {
          type: Type.STRING,
          description: "Qué neumáticos: all, fronts, rears, left, right, lf, rf, lr, rr (solo para change_tires)",
        },
      },
      required: ["action"],
    },
  };

  /**
   * Tool Definition: get_pit_status
   * 
   * Returns current pit stop configuration.
   * 
   * EJEMPLOS DE USO:
   * - "¿Qué tengo puesto para boxes?"
   * - "¿Cuánto combustible voy a echar?"
   * - "¿Qué ruedas voy a cambiar?"
   */
  const getPitStatusTool: FunctionDeclaration = {
    name: "get_pit_status",
    description: "Devuelve la configuración actual de parada en boxes (cantidad de combustible, qué neumáticos se cambiarán, reparación rápida, etc). Úsala para confirmar ajustes o cuando el piloto pregunte qué está configurado para la próxima parada.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  };

  /**
   * Tool Definition: send_chat_macro
   * 
   * Sends a predefined chat macro in iRacing.
   * Macros 1-15 are user-configured in iRacing settings.
   * 
   * EJEMPLOS DE USO:
   * - "Dale las gracias al de delante"
   * - "Pide perdón por el toque"
   * - "Saluda a todos"
   */
  const sendChatMacroTool: FunctionDeclaration = {
    name: "send_chat_macro",
    description: "Envía un macro de chat predefinido en iRacing (1-15). Usos comunes: 1=Gracias, 2=Perdón, 3=Buena suerte (configurable por el usuario). Úsala cuando el piloto pida enviar un mensaje rápido, dar las gracias, o disculparse tras un incidente.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        macroNumber: {
          type: Type.NUMBER,
          description: "Número de macro 1-15. Común: 1=Gracias, 2=Perdón, 3=Buena suerte",
        },
      },
      required: ["macroNumber"],
    },
  };

  export class GeminiLiveService {
    // 🔒 SINGLETON: Prevent multiple instances causing duplicate connections
    private static instance: GeminiLiveService | null = null;
    private static instanceId: number = 0;
    private readonly instanceId: number;

    /**
     * 🔒 SINGLETON: Get or create the single instance of GeminiLiveService
     * This prevents React.StrictMode and other re-renders from creating duplicate connections.
     */
    public static getInstance(
      onMicStateChange: AudioCallback,
      onSpeakingStateChange: AudioCallback,
      onTranscriptUpdate: TranscriptCallback,
      onToolCall: ToolCallback,
      initialContext?: {
        trackName?: string;
        carName?: string;
        sessionType?: string;
        simulator?: string;
      },
      telemetryClient?: any,
      onDisconnect?: () => void,
      onReconnect?: () => void,
    ): GeminiLiveService {
      if (GeminiLiveService.instance) {
        console.log(`[GeminiLive] ♻️ Reusing existing instance #${GeminiLiveService.instance.instanceId}`);
        // Update callbacks in case they changed
        GeminiLiveService.instance.onMicStateChange = onMicStateChange;
        GeminiLiveService.instance.onSpeakingStateChange = onSpeakingStateChange;
        GeminiLiveService.instance.onTranscriptUpdate = onTranscriptUpdate;
        GeminiLiveService.instance.onToolCall = onToolCall;
        GeminiLiveService.instance.onDisconnect = onDisconnect || null;
        GeminiLiveService.instance.onReconnect = onReconnect || null;
        return GeminiLiveService.instance;
      }

      GeminiLiveService.instanceId++;
      console.log(`[GeminiLive] 🆕 Creating new instance #${GeminiLiveService.instanceId}`);
      GeminiLiveService.instance = new GeminiLiveService(
        onMicStateChange,
        onSpeakingStateChange,
        onTranscriptUpdate,
        onToolCall,
        initialContext,
        telemetryClient,
        onDisconnect,
        onReconnect,
      );
      return GeminiLiveService.instance;
    }

    /**
     * 🔒 SINGLETON: Destroy the singleton instance (for testing or full cleanup)
     */
    public static destroyInstance(): void {
      if (GeminiLiveService.instance) {
        console.log(`[GeminiLive] 🗑️ Destroying singleton instance #${GeminiLiveService.instance.instanceId}`);
        GeminiLiveService.instance.disconnect();
        GeminiLiveService.instance = null;
      }
    }

    private session: any = null;
    private bridgeWs: WebSocket | null = null;
    private audioContext: AudioContext | null = null; // ✨ Un solo contexto para input Y output
    private inputSource: MediaStreamAudioSourceNode | null = null;
    private processor: ScriptProcessorNode | null = null;
    private workletNode: AudioWorkletNode | null = null; // OPTIMIZATION: AudioWorklet for off-main-thread processing
    private useAudioWorklet: boolean = true; // OPTIMIZATION: Flag to use AudioWorklet (fallback to ScriptProcessor if not supported)
    private stream: MediaStream | null = null;

    // Audio Playback & FX
    private nextStartTime = 0;
    private audioQueue: AudioBufferSourceNode[] = [];
    private radioBus: GainNode | null = null; // The input to the FX chain
    private playbackGain: GainNode | null = null; // Final output gain for smooth fade-out on barge-in
    private isPlaybackFading = false;

    // Voice Activity Detection (VAD)
    private vadAnalyser: AnalyserNode | null = null;
    private vadCheckInterval: number | null = null;
    private readonly VAD_THRESHOLD = -42; // dB threshold for voice detection
    private readonly VAD_CHECK_INTERVAL = 50; // Check every 50ms
    private readonly BARGE_IN_COOLDOWN_MS = 250;
    private readonly BARGE_IN_DEBOUNCE_MS = 180;
    private readonly BARGE_IN_FADE_MS = 100;
    private recordingActivatedAtMs = 0;
    private voiceActiveSinceMs: number | null = null;
    private hasBargedInThisRecording = false;

    // State & Callbacks
    private onMicStateChange: AudioCallback;
    private onSpeakingStateChange: AudioCallback;
    private onTranscriptUpdate: TranscriptCallback;
    private onToolCall: ToolCallback;
    private onDisconnect: (() => void) | null = null; // 🔄 Callback when disconnected
    private onReconnect: (() => void) | null = null; // 🔄 Callback when reconnected
    private isRecording = false;
    
    // 🔧 WEBSOCKET STATE TRACKING: Track connection state without accessing private properties
    private wsReadyState: number = 3; // 0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED
    private readonly WS_CONNECTING = 0;
    private readonly WS_OPEN = 1;
    private readonly WS_CLOSING = 2;
    private readonly WS_CLOSED = 3;
    
    // 🔧 RECORDING TIMEOUT: Detecta grabaciones largas sin procesar (evita timeout de 60s)
    private recordingTimeout: NodeJS.Timeout | null = null;
    private readonly MAX_RECORDING_DURATION_MS: number | null = null;

    // Data Reference
    private currentTelemetry: TelemetryData | null = null;
    private currentSimHubTelemetry: SimHubTelemetry | null = null;  // 📡 Rich data from SimHub

    // Retry & Reconnection Logic
    private retryCount = 0;
    private maxRetries = 5; // Aumentado de 3 a 5 para sesiones largas
    private retryTimeout: NodeJS.Timeout | null = null;
    private lastConnectionError: string | null = null;
    private telemetryClient: any = null;
    private initialContext: {
      trackName?: string;
      carName?: string;
      sessionType?: string;
      simulator?: string;
    } | null = null;

    private recentEventsBuffer: Array<{
      type: string;
      message: string;
      priority: number;
      timestamp: number;
    }> = [];

    // ✨ Session Stability: Evitar reconexiones infinitas
    private sessionKey: string = "";
    private isConnecting: boolean = false;
    private isConnected: boolean = false;
    
    // 🔄 QUEUE: Cola de mensajes proactivos pendientes (si sesión no está lista)
    private pendingProactiveMessages: Array<{
      text: string;
      timestamp: number;
    }> = [];
    private readonly MAX_PENDING_MESSAGES = 10;
    
    // 📊 CONNECTION METRICS: Estadísticas de conexión para debugging
    private connectionMetrics = {
      totalConnections: 0,
      totalDisconnections: 0,
      totalErrors: 0,
      lastDisconnectTime: 0,
      lastDisconnectReason: "",
      lastDisconnectCode: 0,
      wasLastDisconnectClean: false,
      connectionStartTime: 0,
      longestSessionDuration: 0,
    };

    // 🔒 ONLINE: Turn keep-alive to prevent 10-minute silent starvation
    private lastTurnTime: Date = new Date();
    private keepAliveInterval: NodeJS.Timeout | null = null;
    private readonly TURN_KEEPALIVE_INTERVAL = 5 * 60 * 1000; // 5 minutes

    // 🔒 P0 INPUT LOCK: Prevent audio/telemetry during tool execution
    private isToolExecuting: boolean = false;
    private inputLock: boolean = false;
    private toolExecutionStartTime: number = 0;
    private audioDropCounter: number = 0;
    private hasAudioThisTurn: boolean = false;
    
    // 🔒 WATCHDOG: Tool execution timeout protection (CHANGE 1)
    private toolWatchdogTimer: NodeJS.Timeout | null = null;
    private readonly TOOL_WATCHDOG_TIMEOUT_MS = 18 * 1000; // 18 seconds
    
    // 🔒 READY GATE: Session readiness flag after reconnect (CHANGE 2)
    private isSessionFullyReady: boolean = false;

    // 📦 P2 EVENT BUFFERING: Queue critical events during tool execution
    private pendingEventsQueue: Array<{
      type: 'telemetry' | 'system';
      payload: any;
      timestamp: number;
    }> = [];

    // 🚨 THROTTLE: Prevent context injection saturation
    private lastContextInjectionTime: number = 0;

    // 🔧 COMMAND WEBSOCKET: For sending pit/chat commands to iRacing
    private commandWs: WebSocket | null = null;
    private pendingCommandCallbacks = new Map<string, { resolve: (data: any) => void; reject: (error: Error) => void }>();
    private bridgeSessionConfig: BridgeSessionConfig | null = null;

    // 📝 DEBUG: Session logging para depuración
    private sessionLogs: GeminiLogEntry[] = [];
    private readonly MAX_LOGS = 500;  // Mantener últimas 500 entradas
    private loggingEnabled = true;
    
    // 📁 FILE LOGGING: Guardar logs en archivo automáticamente
    private fileLoggingEnabled = true;
    private fileLoggingInterval: NodeJS.Timeout | null = null;
    private readonly FILE_LOGGING_INTERVAL_MS = 30 * 1000; // 30 segundos
    private logFilePath: string = '';

    // 📊 CONTEXT UPDATES: Timer para updates periódicos de contexto
    private contextUpdateTimer: NodeJS.Timeout | null = null;
    private lastContextUpdateTime: number = 0;
    private lastContextGaps: {
      ahead: number | null;
      behind: number | null;
      toLeader: number | null;
    } = { ahead: null, behind: null, toLeader: null };

    // 🏁 PACE TRACKING: Buffer de últimas vueltas para análisis de ritmo
    private lapTimesHistory: Array<{ lap: number; time: number; timestamp: number }> = [];
    private readonly MAX_LAP_HISTORY = 10;

    // 🗣️ AUDIO GATING: Evita que Gemini hable cuando NO esperamos respuesta (p.ej. [CONTEXTO])
    private expectedModelTurns: number = 0;

    // 🛡️ P0-FIX1: DEBOUNCE RACE EVENTS - Previene respuestas duplicadas por eventos rápidos
    private lastRaceEventTime: number = 0;
    private readonly RACE_EVENT_DEBOUNCE_MS = 5000; // 5 segundos

    // 🛡️ P0-FIX3: GLOBAL ANTI-SPAM GUARD - Intervalo mínimo entre cualquier mensaje
    private lastMessageSentTime: number = 0;
    private readonly MIN_MESSAGE_INTERVAL_MS = 3000; // 3 segundos

    // 🧠 ESTRATEGIA: Cadencia de updates proactivos (por defecto cada 5 vueltas)
    private readonly STRATEGY_UPDATE_LAP_INTERVAL = 5;

    /**
     * 🔒 Verifica si la sesión de Gemini Live está realmente activa y lista para enviar audio.
     * CRÍTICO: El audio NO debe enviarse si el WebSocket está cerrado o cerrándose.
     * 🔒 READY GATE: También verifica que la sesión esté completamente inicializada (CHANGE 2)
     * 
     * 🔧 REFACTORIZADO: Usa tracking de estado propio en lugar de acceder a propiedades privadas
     */
    private isSessionReady(): boolean {
      // La sesión debe existir y estar conectada
      if (!this.session || !this.isConnected) {
        return false;
      }
      
      // 🔒 READY GATE: Session must be fully ready after reconnect (CHANGE 2)
      // This prevents audio/context updates before session is fully initialized
      if (!this.isSessionFullyReady) {
        return false;
      }

      // 🔧 REFACTORIZADO: Usar nuestro tracking de estado en lugar de acceder al WS privado
      // Verificar que el WebSocket esté en estado OPEN (1)
      return this.wsReadyState === this.WS_OPEN;
    }
    
    /**
     * 📊 PUBLIC: Get connection status for debugging
     * Exposes internal state for troubleshooting connection issues
     * 🔧 REFACTORIZADO: Usa tracking de estado propio
     */
    public getConnectionStatus(): {
      isConnected: boolean;
      isConnecting: boolean;
      isSessionReady: boolean;
      isWaitingForResponse: boolean;
      lastResponseTime: number;
      lastTurnTime: Date;
      retryCount: number;
      metrics: Record<string, any>;
      wsState: string;
    } {
      const wsStateMap: Record<number, string> = {
        0: 'CONNECTING',
        1: 'OPEN',
        2: 'CLOSING',
        3: 'CLOSED',
      };
      
      return {
        isConnected: this.isConnected,
        isConnecting: this.isConnecting,
        isSessionReady: this.isSessionReady(),
        isWaitingForResponse: this.isWaitingForResponse,
        lastResponseTime: this.lastResponseTime,
        lastTurnTime: this.lastTurnTime,
        retryCount: this.retryCount,
        metrics: { ...this.connectionMetrics },
        wsState: wsStateMap[this.wsReadyState] || 'UNKNOWN',
      };
    }

    /**
     * 🔒 ONLINE: Send safe heartbeat to prevent turn starvation
     * After long periods of silence (3+ minutes), Gemini Live may stop responding
     * Send a silent client message to keep the turn active without generating speech
     */
    private sendSafeHeartbeat(): void {
      if (!this.isSessionReady()) {
        console.log("[GeminiLive] ⏸️ Skipping heartbeat: session not ready");
        return;
      }

      const now = new Date();
      const timeSinceLastTurn = now.getTime() - this.lastTurnTime.getTime();

      // Heartbeat cada 2 minutos (reducido de 3 para prevenir timeout de 10 min)
      if (timeSinceLastTurn > 2 * 60 * 1000) {
        console.log(
          "[GeminiLive] 💓 Heartbeat sent - keeping session alive",
        );

        try {
          // Send a silent keepalive using legal client content
          this.sendAndLog(
            {
              turns: [
                {
                  role: "user",
                  parts: [
                    {
                      text: "[CONTEXTO]\n[KEEP_ALIVE_SILENT]",
                    },
                  ],
                },
              ],
            },
            'heartbeat',
            { timeSinceLastTurn: Math.floor(timeSinceLastTurn / 1000) }
          );

          console.log("[GeminiLive] ✅ Heartbeat sent successfully");
        } catch (err) {
          console.warn("[GeminiLive] ⚠️ Heartbeat failed:", err);
          // Not critical, will retry next interval
        }
      }
    }

    /**
     * 🔒 ONLINE: Start safe heartbeat
     * Monitorea la salud de la conexión y envía heartbeat si es necesario
     */
    private startKeepAlive(): void {
      if (this.keepAliveInterval) {
        clearInterval(this.keepAliveInterval);
      }

      // 🔄 Check every 15s for faster recovery (was 60s)
      this.keepAliveInterval = setInterval(() => {
        // Verificar si la sesión sigue activa
        if (!this.isSessionReady()) {
          console.warn("[GeminiLive] 💓 Keep-alive detected session not ready, connection may be dead");
          
          // 🔄 Si la sesión no está lista y ha pasado >15s, intentar reconectar (was 60s)
          const timeSinceLastDisconnect = Date.now() - this.connectionMetrics.lastDisconnectTime;
          if (timeSinceLastDisconnect > 15000 && this.initialContext && !this.isConnecting) {
            console.warn("[GeminiLive] 💓 Attempting recovery reconnection...");
            this.scheduleReconnection(this.initialContext);
          }
          return;
        }
        
        this.sendSafeHeartbeat();
      }, 15 * 1000); // 🔄 Check every 15s (was 60s)

      console.log(
        "[GeminiLive] 💓 Safe heartbeat started (check every 15s, send if >2min silence)",
      );
    }

    /**
     * 🔒 ONLINE: Stop keep-alive heartbeat
     */
    private stopKeepAlive(): void {
      if (this.keepAliveInterval) {
        clearInterval(this.keepAliveInterval);
        this.keepAliveInterval = null;
        console.log("[GeminiLive] 💓 Keep-alive heartbeat stopped");
      }
    }

    /**
     * 🔒 P0 INPUT LOCK: Set execution state and lock/unlock inputs
     */
    private setExecutionState(isExecuting: boolean): void {
      this.isToolExecuting = isExecuting;
      this.inputLock = isExecuting;
      
      if (isExecuting) {
        this.toolExecutionStartTime = Date.now();
        console.log('🔒 Input LOCKED for tool execution');
        console.log('⏸️ Heartbeat paused during tool execution');
        this.stopKeepAlive(); // Pause heartbeat
        this.startToolWatchdog(); // 🔒 WATCHDOG: Start timeout protection (CHANGE 1)
      } else {
        console.log('🔓 Input UNLOCKED');
        console.log('▶️ Heartbeat resumed after tool execution');
        this.lastTurnTime = new Date(); // Reset timer
        this.startKeepAlive(); // Resume heartbeat
        this.clearToolWatchdog(); // 🔒 WATCHDOG: Clear timeout (CHANGE 1)
        this.flushEventQueue(); // 📦 P2: Process buffered events
      }
    }
    
    /**
     * 🔒 WATCHDOG: Start tool execution timeout protection (CHANGE 1)
     * If tool execution hangs or crashes, forcefully release the input lock after timeout.
     * This prevents the system from being permanently muted if a tool never completes.
     */
    private startToolWatchdog(): void {
      // Clear any existing watchdog
      this.clearToolWatchdog();
      
      this.toolWatchdogTimer = setTimeout(() => {
        if (this.isToolExecuting || this.inputLock) {
          const duration = Date.now() - this.toolExecutionStartTime;
          console.error(`🚨 WATCHDOG TIMEOUT: Tool execution exceeded ${this.TOOL_WATCHDOG_TIMEOUT_MS}ms (actual: ${duration}ms)`);
          console.error('🚨 Forcefully releasing input lock to prevent permanent mute');
          
          // Forcefully unlock inputs
          this.isToolExecuting = false;
          this.inputLock = false;
          
          // Resume normal operations
          this.lastTurnTime = new Date();
          this.startKeepAlive();
          
          // Clear any pending events (they may be stale)
          this.pendingEventsQueue = [];
          
          console.error('🚨 System recovered from tool execution hang - input unlocked');
        }
      }, this.TOOL_WATCHDOG_TIMEOUT_MS);
      
      console.log(`⏱️ Tool watchdog started (${this.TOOL_WATCHDOG_TIMEOUT_MS}ms timeout)`);
    }
    
    /**
     * 🔒 WATCHDOG: Clear tool execution timeout (CHANGE 1)
     * Called when tool execution completes successfully or encounters an error.
     */
    private clearToolWatchdog(): void {
      if (this.toolWatchdogTimer) {
        clearTimeout(this.toolWatchdogTimer);
        this.toolWatchdogTimer = null;
        console.log('✅ Tool watchdog cleared');
      }
    }

    /**
     * 📦 P2 EVENT BUFFERING: Detect critical telemetry events
     */
    private isCriticalTelemetryEvent(data: TelemetryData): string | null {
      // Detect critical race events that should be queued
      if (data.flags?.active?.includes('yellow')) return 'yellow_flag';
      if (data.flags?.active?.includes('red')) return 'red_flag';
      if (data.pit?.inPitLane && !this.currentTelemetry?.pit?.inPitLane) return 'pit_entry';
      if (!data.pit?.inPitLane && this.currentTelemetry?.pit?.inPitLane) return 'pit_exit';
      if (data.pit?.inPitStall) return 'pit_stall';
      
      // Add other critical conditions as needed
      return null;
    }

    /**
     * 📤 P2 EVENT BUFFERING: Flush queued events after tool execution
     */
    private flushEventQueue(): void {
      if (this.pendingEventsQueue.length === 0) {
        return;
      }
      
      console.log(`📤 Flushing ${this.pendingEventsQueue.length} queued events after tool execution`);
      
      // Process critical events in order
      for (const event of this.pendingEventsQueue) {
        if (event.type === 'telemetry') {
          console.log(`  ↳ Processing queued ${event.payload.SessionFlags || 'telemetry'} event`);
          // Events are already in currentTelemetry, just log for now
        }
      }
      
      // Send latest telemetry snapshot (already in currentTelemetry)
      if (this.currentTelemetry) {
        console.log('  ↳ Sending latest telemetry snapshot');
        // The normal sendContextUpdate will be called after unlock
      }
      
      // Clear queue
      this.pendingEventsQueue = [];
    }

    /**
     * 🔍 MONITORING: Log current lock state for debugging
     */
    private logLockState(context: string): void {
      const state = {
        inputLock: this.inputLock,
        isToolExecuting: this.isToolExecuting,
        queuedEvents: this.pendingEventsQueue.length,
        sessionReady: this.isSessionReady(),
        context: context
      };
      console.log('🔍 Lock State:', JSON.stringify(state, null, 2));
    }

    /**
     * 🏥 MONITORING: Log session health metrics
     */
    private logSessionHealth(): void {
      const now = Date.now();
      const timeSinceLastTurn = now - this.lastTurnTime.getTime();
      const health = {
        sessionActive: this.isSessionReady(),
        inputLocked: this.inputLock,
        timeSinceLastTurn: `${Math.floor(timeSinceLastTurn / 1000)}s`,
        queuedEvents: this.pendingEventsQueue.length,
        audioDropped: this.audioDropCounter
      };
      console.log('🏥 Session Health:', JSON.stringify(health, null, 2));
    }

    /**
     * 🔄 RECONNECTION FIX: Send wake-up message after reconnection
     * Gemini Live needs a first turn to activate after reconnection
     * Without this, the model won't respond to audio input
     */
    private async sendReconnectionWakeUp(): Promise<void> {
    if (!this.isSessionReady()) {
      console.warn("[GeminiLive] ⚠️ Cannot send wake-up - session not ready");
      return;
    }

    console.log("[GeminiLive] 🔄 Sending silent reconnection context...");

    try {
      // Get current telemetry context for the wake-up message
      const context = this.getContextSummary();
      
      // 🔇 SILENT RECONNECTION: No pedir confirmación verbal
      // Solo restaurar el contexto para que Gemini sepa dónde estamos
      const wakeUpMessage = `[CONTEXTO_RECONEXION]
 La conexión se ha restablecido automáticamente. Continúa monitorizando la sesión.

 ${context ? `Estado actual:\n${context}` : 'Esperando datos de telemetría...'}

 NOTA: Este mensaje es solo para restaurar tu contexto. No lo vocalices.`;

      this.sendAndLog(
        {
          turns: [
            {
              role: "user",
              parts: [{ text: wakeUpMessage }],
            },
          ],
        },
        'reconnection_wakeup',
        {
          sessionKey: this.sessionKey,
          reconnectCount: this.connectionMetrics.totalConnections
        }
      );
      console.log("[GeminiLive] ✅ Silent reconnection context sent");
    } catch (error) {
      console.error("[GeminiLive] ❌ Failed to send reconnection context:", error);
      // Not critical - the model should still work, just might be slower to respond
    }
  }

    /**
     * 🔄 PROACTIVE RECONNECTION: Timer to reconnect before 10-minute timeout
     * Gemini Live has a hard 10-minute session limit
     * We reconnect proactively at 9 minutes to avoid mid-conversation drops
     */
    private proactiveReconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    private readonly PROACTIVE_RECONNECT_MS = 9 * 60 * 1000; // 9 minutes

    private startProactiveReconnectTimer(): void {
      this.stopProactiveReconnectTimer();
      
      this.proactiveReconnectTimeout = setTimeout(async () => {
        if (!this.isConnected || !this.initialContext) {
          return;
        }

        console.log("[GeminiLive] ⏰ Proactive reconnection triggered (9 min limit approaching)");
        console.log("[GeminiLive] 🔄 Initiating graceful reconnection...");

        // 📝 LOG: Registrar reconexión proactiva
        this.logEntry('event', 'proactive_reconnect', 'Initiating proactive reconnection before 10-min timeout', {
          sessionDuration: `${((Date.now() - this.connectionMetrics.connectionStartTime) / 1000).toFixed(1)}s`
        });

        try {
          // Disconnect cleanly
          await this.disconnect();
          
          // Small delay to ensure clean disconnect
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // Reconnect with same context
          await this.connect(this.initialContext);
          
          // 🔧 CRÍTICO: Reanudar AudioContext después de reconexión proactiva
          if (this.audioContext && this.audioContext.state === 'suspended') {
            console.log("[GeminiLive] 🔊 Resuming AudioContext after proactive reconnection...");
            try {
              await this.audioContext.resume();
              console.log("[GeminiLive] ✅ AudioContext resumed successfully");
            } catch (resumeError) {
              console.warn("[GeminiLive] ⚠️ Failed to resume AudioContext:", resumeError);
            }
          }
          
          // 🛡️ P0-FIX2: RECONNECTION WAKE-UP REMOVED
          // Razón: El mensaje puede causar respuestas de audio no deseadas ("dos voces")
          // Gemini funciona correctamente sin este mensaje - el modelo se reactiva con el primer input real
          // await this.sendReconnectionWakeUp();

          console.log("[GeminiLive] ✅ Proactive reconnection completed successfully");
        } catch (error) {
          console.error("[GeminiLive] ❌ Proactive reconnection failed:", error);
          // Schedule retry through normal reconnection mechanism
          if (this.initialContext) {
            this.scheduleReconnection(this.initialContext);
          }
        }
      }, this.PROACTIVE_RECONNECT_MS);

      console.log(`[GeminiLive] ⏰ Proactive reconnection scheduled in ${this.PROACTIVE_RECONNECT_MS / 60000} minutes`);
    }

    private stopProactiveReconnectTimer(): void {
      if (this.proactiveReconnectTimeout) {
        clearTimeout(this.proactiveReconnectTimeout);
        this.proactiveReconnectTimeout = null;
      }
    }

    /**
     * 📊 Get a brief context summary for wake-up messages
     */
    private getContextSummary(): string | null {
      if (!this.currentTelemetry) {
        return null;
      }

      const t = this.currentTelemetry;
      const parts: string[] = [];

      if (t.session?.trackName) parts.push(`Circuito: ${t.session.trackName}`);
      if (t.session?.carName) parts.push(`Coche: ${t.session.carName}`);
      if (t.session?.type) parts.push(`Sesión: ${t.session.type}`);
      if (t.position?.overall && t.position?.totalCars) parts.push(`Posición: P${t.position.overall}/${t.position.totalCars}`);
      if (t.timing?.currentLap) parts.push(`Vuelta: ${t.timing.currentLap}`);

      return parts.length > 0 ? parts.join(' | ') : null;
    }

    /**
     * 🏁 PACE TRACKING: Get last 3 valid lap times and calculate mean
     */
    private getPaceAnalysis(): { last3: number[]; mean3: number | null } {
      const validLaps = this.lapTimesHistory
        .filter(lap => lap.time > 0)
        .slice(-3);
      
      if (validLaps.length === 0) {
        return { last3: [], mean3: null };
      }

      const times = validLaps.map(lap => lap.time);
      const mean3 = times.reduce((sum, time) => sum + time, 0) / times.length;
      
      return { last3: times, mean3 };
    }

    /**
     * 🏁 PACE TRACKING: Get session best lap from standings
     */
    private getSessionBestLap(telemetry: TelemetryData): number | null {
      if (!telemetry.standings || telemetry.standings.length === 0) {
        return null;
      }

      const validTimes = telemetry.standings
        .map(driver => driver.fastestTime)
        .filter(time => time > 0);

      if (validTimes.length === 0) {
        return null;
      }

      return Math.min(...validTimes);
    }

    /**
     * 🏁 PACE TRACKING: Update lap times history
     */
    private updateLapTimesHistory(lap: number, time: number): void {
      if (time <= 0) return;

      this.lapTimesHistory.push({
        lap,
        time,
        timestamp: Date.now()
      });

      if (this.lapTimesHistory.length > this.MAX_LAP_HISTORY) {
        this.lapTimesHistory.shift();
      }
    }

    /**
     * 🏁 RELATIVE STANDINGS: Get exactly ±4 positions around player
     * Shows 4 drivers ahead and 4 behind, with iRating and SR
     */
    private getRelativeStandings(telemetry: TelemetryData, myPosition: number): string {
      const standings = telemetry.standings;

      if (!standings || standings.length === 0) {
        return 'Relativo: Sin datos';
      }

      const myIndex = standings.findIndex(driver => driver.position === myPosition);
      if (myIndex === -1) {
        return 'Relativo: Posición no encontrada';
      }

      const lines: string[] = [];
      
      const startIndex = Math.max(0, myIndex - 4);
      const endIndex = Math.min(standings.length - 1, myIndex + 4);
      
      for (let i = startIndex; i <= endIndex; i++) {
        const driver = standings[i];
        const name = driver.userName || driver.name || '?';
        const iRating = driver.iRating || 0;
        const license = driver.license || '?';
        
        if (driver.position === myPosition) {
          lines.push(`  P${driver.position}: ${name}`);
        } else {
          let gapStr = '?';
          if (driver.gapToLeader !== undefined && driver.gapToLeader > 0) {
            gapStr = `+${driver.gapToLeader.toFixed(1)}s`;
          } else if (driver.gapToLeader === 0) {
            gapStr = '0.0s';
          }
          
          lines.push(`  P${driver.position}: ${name} ${gapStr} (${iRating} iR - ${license})`);
        }
      }

      return lines.join('\n');
    }
    
    /**
     * 🏁 LEADER INFO: Get leader information with gap, iR and SR
     */
    private getLeaderInfo(telemetry: TelemetryData, myPosition: number): string {
      const standings = telemetry.standings;
      
      if (!standings || standings.length === 0) {
        return 'LIDER: Sin datos';
      }
      
      const leader = standings.find(driver => driver.position === 1);
      if (!leader) {
        return 'LIDER: No encontrado';
      }
      
      if (myPosition === 1) {
        return 'LIDER: TÚ';
      }
      
      const name = leader.userName || leader.name || '?';
      const iRating = leader.iRating || 0;
      const license = leader.license || '?';
      
      const myDriver = standings.find(driver => driver.position === myPosition);
      let gapStr = '?';
      if (myDriver && myDriver.gapToLeader !== undefined && myDriver.gapToLeader > 0) {
        gapStr = `-${myDriver.gapToLeader.toFixed(1)}s`;
      }
      
      return `LIDER:\n  P1: ${name} ${gapStr} (${iRating} iR - ${license})`;
    }

    /**
     * 🏁 PACING DETECTION: Check if in formation/safety car period
     */
    private isPacingActive(telemetry: TelemetryData): 'YES' | 'NO' {
      const state = telemetry.session?.state;
      
      if (state === 'parade_laps' || state === 'warmup') {
        return 'YES';
      }

      return 'NO';
    }

    constructor(
      onMicStateChange: AudioCallback,
      onSpeakingStateChange: AudioCallback,
      onTranscriptUpdate: TranscriptCallback,
      onToolCall: ToolCallback,
      initialContext?: {
        trackName?: string;
        carName?: string;
        sessionType?: string;
        simulator?: string;
      },
      telemetryClient?: any, // Optional TelemetryClient for setup data
      onDisconnect?: () => void, // 🔄 Callback when disconnected
      onReconnect?: () => void, // 🔄 Callback when reconnected
    ) {
      // 🔒 SINGLETON: Assign instance ID
      this.instanceId = GeminiLiveService.instanceId;
      this.onMicStateChange = onMicStateChange;
      this.onSpeakingStateChange = onSpeakingStateChange;
      this.onTranscriptUpdate = onTranscriptUpdate;
      this.onToolCall = onToolCall;
      this.initialContext = initialContext || null;
      this.telemetryClient = telemetryClient;
      this.onDisconnect = onDisconnect || null;
      this.onReconnect = onReconnect || null;
      
      // 📁 Inicializar file logging (async pero no bloqueante)
      this.initializeFileLogging().catch(err => 
        console.error('Failed to initialize file logging:', err)
      );
    }

    // 🔔 Alert tracking to avoid spam
    private lastSnapshotType: string = '';
    private lastSnapshotTime: number = 0;
    private lastAlertSent: Record<string, number> = {};
    private readonly REPEAT_COOLDOWN_MS = 45 * 1000;

    public updateTelemetry(data: TelemetryData) {
      // 🔒 SANITY CHECK: Ignore 0.0 fuel updates if we had valid fuel before
      // This prevents "fuel critical" alerts when telemetry flickers to 0 during initialization or connection
      if (data.fuel && (data.fuel.level === 0 || data.fuel.level === null) && this.currentTelemetry?.fuel?.level && this.currentTelemetry.fuel.level > 0.5) {
        console.warn(`[GeminiLive] ⚠️ Ignoring invalid fuel reading: ${data.fuel.level}L (prev: ${this.currentTelemetry.fuel.level.toFixed(1)}L)`);
        // Keep previous fuel data
        data.fuel = { ...this.currentTelemetry.fuel };
      }
      // 🔒 SANITY CHECK: Validate timestamp freshness (prevent phantom data)
      const currentTime = Date.now();
      const telemetryAge = currentTime - data.timestamp;
      const MAX_TELEMETRY_AGE_MS = 10 * 1000; // 10 seconds
      
      if (telemetryAge > MAX_TELEMETRY_AGE_MS) {
        console.warn(
          `[GeminiLive] ⚠️ STALE TELEMETRY REJECTED in updateTelemetry: ${(telemetryAge / 1000).toFixed(1)}s old`
        );
        return; // Don't process stale data at all
      }
      
      const prevTelemetry = this.currentTelemetry;
      this.currentTelemetry = data;
      
      // 📊 Enviar contexto periódico a Gemini (cada 10s)
      this.sendContextUpdate(data);
      
      // 🚨 Detectar y enviar alertas críticas
      this.checkCriticalAlerts(data, prevTelemetry);
    }

    /**
     * 📡 Update SimHub telemetry (rich data with sectors, fuel calc, etc.)
     */
    public updateSimHubTelemetry(data: SimHubTelemetry): void {
      this.currentSimHubTelemetry = data;
      
      // Fuel alerts disabled by design (strategy-only guidance)
    }

    /**
     * Get current SimHub telemetry
     */
    public getSimHubTelemetry(): SimHubTelemetry | null {
      return this.currentSimHubTelemetry;
    }

    /**
     * 🏁 HANDLE RACE EVENT - Procesa eventos de carrera para comunicación proactiva
     * Estos eventos hacen que el ingeniero HABLE sin que el piloto pregunte
     * USA turnComplete: true para FORZAR respuesta de Gemini
     */
    public handleRaceEvent(eventType: string, eventData: any, telemetry: TelemetryData): void {
      if (!this.isSessionReady()) {
        console.log(`[GeminiLive] ⚠️ Race event ${eventType} ignored - session not ready`);
        return;
      }

      // 🛡️ P0-FIX1: DEBOUNCE - Prevenir eventos de carrera en rápida sucesión
      const now = Date.now();
      const timeSinceLastEvent = now - this.lastRaceEventTime;
      if (timeSinceLastEvent < this.RACE_EVENT_DEBOUNCE_MS) {
        console.log(`[GeminiLive] ⏸️ Race event ${eventType} DEBOUNCED (${(timeSinceLastEvent/1000).toFixed(1)}s < ${this.RACE_EVENT_DEBOUNCE_MS/1000}s)`);
        return;
      }
      this.lastRaceEventTime = now;

      // 🔧 FIX: Si llevamos mucho tiempo esperando respuesta, resetear el flag
      // Esto evita que eventos importantes se bloqueen por una respuesta que nunca llegó
      if (this.isWaitingForResponse) {
        const waitTime = Date.now() - this.lastResponseTime;
        if (waitTime > 15000) { // 15s timeout para eventos de carrera
          console.log(`[GeminiLive] ⚠️ Response timeout (${(waitTime/1000).toFixed(1)}s), resetting wait flag`);
          this.isWaitingForResponse = false;
        }
      }

      // Formatear el mensaje con instrucciones para Gemini
      const eventMessage = this.formatRaceEventWithInstructions(eventType, eventData, telemetry);
      if (!eventMessage) {
        return;
      }

      console.log(`[GeminiLive] 🏁 INJECTING RACE EVENT: ${eventType}`);

      try {
        this.sendAndLog(
          {
            turns: [
              {
                role: "user",
                parts: [{ text: eventMessage }],
              },
            ],
            turnComplete: true, // ⚡ FORZAR RESPUESTA
          },
          'race_event',
          { eventType, eventData }
        );

        this.isWaitingForResponse = true; // 🔧 FIX: Track pending response
      } catch (error) {
        this.logEntry('error', 'race_event', `Failed: ${error}`, { eventType });
        console.error(`[GeminiLive] ❌ Failed to inject race event:`, error);
      }
    }

    /**
     * 📝 Formatea mensaje de evento CON INSTRUCCIONES para que Gemini responda
     */
    private formatRaceEventWithInstructions(eventType: string, data: any, telemetry: TelemetryData): string | null {
      switch (eventType) {
        case 'position_change': {
          const change = data.change;
          const to = data.to;
          if (Math.abs(change) < 1) return null;
          
          const direction = change > 0 ? 'GANADO' : 'PERDIDO';
          const gapAhead = data.gapAhead?.toFixed(1) || '?';
          const gapBehind = data.gapBehind?.toFixed(1) || '?';
          
          return `[EVENTO: CAMBIO DE POSICIÓN]
  Has ${direction} ${Math.abs(change)} posición(es). Ahora P${to}.
  Gap delante: ${gapAhead}s | Gap detrás: ${gapBehind}s

  [INSTRUCCIÓN]: Comunica este cambio de posición al piloto. Si ganó, felicita brevemente. Si perdió, motívale. Menciona el gap al siguiente objetivo. Máximo 2 frases, estilo radio.`;
        }

        case 'flag_change': {
          const flags = data.flags as string[];
          if (!flags || flags.length === 0) return null;
          
          if (flags.some(f => f.toLowerCase().includes('green'))) {
            return `[EVENTO: BANDERA VERDE]
  La carrera está en verde. Luz verde.

  [INSTRUCCIÓN]: ¡Anuncia la bandera verde con energía! "Verde verde verde" o similar. Motiva al piloto para el inicio. Recuérdale tener cuidado en la primera curva. Máximo 2 frases.`;
          }
          
          if (flags.some(f => f.toLowerCase().includes('yellow') || f.toLowerCase().includes('caution'))) {
            return `[EVENTO: BANDERA AMARILLA]
  Precaución en pista. Bandera amarilla.

  [INSTRUCCIÓN]: Alerta al piloto de la amarilla. Que levante el pie y tenga cuidado. Tono urgente pero no de pánico. 1-2 frases.`;
          }
          
          if (flags.some(f => f.toLowerCase().includes('white'))) {
            return `[EVENTO: BANDERA BLANCA]
  Última vuelta de la carrera.

  [INSTRUCCIÓN]: Anuncia la última vuelta. Motiva al piloto a dar el máximo. Si hay alguien cerca, recuérdaselo. Estilo radio F1.`;
          }
          
          if (flags.some(f => f.toLowerCase().includes('checkered'))) {
            return `[EVENTO: BANDERA A CUADROS]
  Carrera terminada. Posición final: P${telemetry.position?.overall || '?'}

  [INSTRUCCIÓN]: Felicita al piloto por terminar la carrera. Comenta brevemente el resultado. Si acabó en buen puesto, celébralo. Si no, anímale para la siguiente.`;
          }
          
          if (flags.some(f => f.toLowerCase().includes('blue'))) {
            return `[EVENTO: BANDERA AZUL]
  Coches más rápidos aproximándose por detrás.

  [INSTRUCCIÓN]: Avisa al piloto de la azul. Que facilite el adelantamiento cuando sea seguro. Breve y claro.`;
          }
          
          if (flags.some(f => f.toLowerCase().includes('red'))) {
            return `[EVENTO: BANDERA ROJA]
  Sesión detenida. Bandera roja.

  [INSTRUCCIÓN]: Alerta al piloto de la bandera roja. Que vuelva a boxes inmediatamente. Tono urgente y claro.`;
          }
          
          if (flags.some(f => f.toLowerCase().includes('black'))) {
            return `[EVENTO: BANDERA NEGRA]
  Penalización o descalificación.

  [INSTRUCCIÓN]: Informa al piloto de la bandera negra. Que vaya a boxes. Tono serio pero calmado.`;
          }
          
          return null;
        }

        case 'lap_complete': {
          const lapTime = data.lapTime;
          const lap = data.lap;
          const delta = data.delta;
          const fuelUsed = data.fuelUsed; // Nuevo: consumo de esta vuelta
          
          // 🏁 Update lap times history for pace tracking
          if (lapTime > 0 && lap > 0) {
            this.updateLapTimesHistory(lap, lapTime);
          }
          
          // 🔧 FORMAT TIME FOR GEMINI
          const timeStr = formatTimeForGemini(lapTime);
          const fuelStr = fuelUsed ? `${fuelUsed.toFixed(2)}L` : 'N/A';
          const perLapAvg = telemetry.fuel?.perLapAvg ? `${telemetry.fuel.perLapAvg.toFixed(2)}L` : 'N/A';
          
          // Si es mejor vuelta personal, siempre comunicar
          if (delta && delta < -0.3) {
            return `[EVENTO: MEJOR VUELTA PERSONAL]
  Vuelta ${lap}: ${timeStr}
  Consumo: ${fuelStr} (Media: ${perLapAvg})
  Mejora: ${Math.abs(delta).toFixed(3)}s más rápido que tu anterior mejor.

  [INSTRUCCIÓN]: ¡Felicita al piloto por la mejor vuelta! Menciona el tiempo y la mejora. Comenta brevemente el consumo si es relevante (bajo/alto vs media). Breve, con energía positiva.`;
          }
          
          // ✅ NO reportar cada vuelta: solo cada N vueltas o si detectamos cambio relevante.
          // El piloto ya tiene relative; aquí queremos tendencia + plan.
          if (!lap || lap < 3) return null;

          const { mean3 } = this.getPaceAnalysis();
          const paceDelta = (mean3 !== null && lapTime && lapTime > 0) ? (lapTime - mean3) : null;
          const paceDeltaAbs = paceDelta !== null ? Math.abs(paceDelta) : 0;

          const periodic = (lap % this.STRATEGY_UPDATE_LAP_INTERVAL) === 0;
          const bigPaceSwing = paceDelta !== null && paceDeltaAbs >= 1.0;
          const bigFuelSwing =
            typeof fuelUsed === 'number' &&
            fuelUsed > 0 &&
            typeof telemetry.fuel?.perLapAvg === 'number' &&
            telemetry.fuel.perLapAvg > 0 &&
            Math.abs(fuelUsed - telemetry.fuel.perLapAvg) >= 0.4;

          if (!periodic && !bigPaceSwing && !bigFuelSwing) return null;

          // Rival inmediato (si tenemos standings)
          const myPos = telemetry.position?.overall || 0;
          const ahead = myPos > 1 ? telemetry.standings?.find(d => d.position === myPos - 1) : null;
          const behind = myPos > 0 ? telemetry.standings?.find(d => d.position === myPos + 1) : null;
          const aheadName = (ahead?.userName || (ahead as any)?.name) ? (ahead?.userName || (ahead as any)?.name) : null;
          const behindName = (behind?.userName || (behind as any)?.name) ? (behind?.userName || (behind as any)?.name) : null;

          const gapAhead = typeof telemetry.gaps?.ahead === 'number' && telemetry.gaps.ahead > 0 ? telemetry.gaps.ahead : null;
          const gapBehind = typeof telemetry.gaps?.behind === 'number' && telemetry.gaps.behind > 0 ? telemetry.gaps.behind : null;
          const fmtGap = (v: number | null) => v === null ? 'N/A' : `${v.toFixed(1)}s`;

          // Progreso de carrera (vueltas o tiempo)
          const timeRemaining = typeof telemetry.session?.timeRemaining === 'number' ? telemetry.session.timeRemaining : 0;
          const estLapTime = typeof telemetry.session?.estLapTime === 'number' ? telemetry.session.estLapTime : 0;
          const lapsTotal = typeof telemetry.session?.lapsTotal === 'number' ? telemetry.session.lapsTotal : 0;
          const lapsCompleted = typeof telemetry.timing?.lapsCompleted === 'number' ? telemetry.timing.lapsCompleted : null;
          const lapsRemaining = typeof telemetry.session?.lapsRemaining === 'number' ? telemetry.session.lapsRemaining : 0;
          const lapsToGoFromTime = (timeRemaining > 0 && estLapTime > 0) ? Math.ceil(timeRemaining / estLapTime) : null;
          const timeRemMin = timeRemaining > 0 ? Math.floor(timeRemaining / 60) : null;

          const progressLine = (() => {
            if (lapsTotal > 0 && lapsCompleted !== null) {
              return `Progreso: ${lapsCompleted}/${lapsTotal} vueltas`;
            }
            if (lapsRemaining > 0) {
              return `Restan: ${lapsRemaining} vueltas`;
            }
            if (timeRemMin !== null) {
              return `Restan: ${timeRemMin} min` + (lapsToGoFromTime ? ` (~${lapsToGoFromTime}v)` : '');
            }
            return `Progreso: vuelta ${lap}`;
          })();

          // Fuel: solo incluir números si afecta a la estrategia (cerca del final / ventana)
          const fuelLaps = typeof telemetry.fuel?.estimatedLapsRemaining === 'number' ? telemetry.fuel.estimatedLapsRemaining : null;
          const lapsToFinish =
            lapsRemaining > 0 ? lapsRemaining :
            (lapsToGoFromTime !== null ? lapsToGoFromTime : null);
          const fuelTight =
            fuelLaps !== null &&
            lapsToFinish !== null &&
            fuelLaps <= (lapsToFinish + 1.0);
          const fuelLine = fuelTight
            ? `Fuel: ${fuelStr} (media ${perLapAvg}) | quedan ~${fuelLaps!.toFixed(1)}v`
            : `Fuel: OK`;

          const mean3Str = mean3 !== null ? formatTimeForGemini(mean3) : 'N/A';
          const paceDeltaStr = paceDelta === null ? 'N/A' : `${paceDelta >= 0 ? '+' : ''}${paceDelta.toFixed(2)}s vs media3`;

          return `[EVENTO: UPDATE ESTRATEGIA]
  Vuelta ${lap}: ${timeStr} (${paceDeltaStr}, media3 ${mean3Str})
  ${progressLine}
  ${fuelLine}
  Rivales: delante ${aheadName || '?'} ${fmtGap(gapAhead)} | detrás ${behindName || '?'} ${fmtGap(gapBehind)}

  [INSTRUCCIÓN]: En 1-2 frases, da una recomendación CONCRETA basada en tendencia (ritmo/ataque/defensa/ventana de box). No recites gaps/fuel salvo que cambien la decisión.`;
        }

        case 'pit_entry':
          return `[EVENTO: ENTRADA A BOXES]
  El piloto está entrando a pit lane.
  Fuel actual: ${data.fuelLevel?.toFixed(1) || '?'}L

  [INSTRUCCIÓN]: Confirma la entrada a boxes. Recuérdale el límite de velocidad del pit lane si quieres. Breve.`;

        case 'pit_exit':
          return `[EVENTO: SALIDA DE BOXES]
  El piloto sale del pit lane con neumáticos frescos.

  [INSTRUCCIÓN]: Motívale para la salida. "A por ellos" o algo así. Recuérdale que las gomas estarán frías las primeras curvas. Breve, con energía.`;

        case 'incident':
          if (data.added >= 2) {
            return `[EVENTO: INCIDENTES]
  +${data.added}x incidentes detectados.
  Total acumulado: ${data.count}/${data.limit}

  [INSTRUCCIÓN]: Avisa del incidente sin dramatizar. Recuérdale el límite de incidentes. Si está cerca del límite, enfatiza que tenga cuidado. 1-2 frases.`;
          }
          return null;

        case 'session_state_change':
          if (data.to === 'Racing') {
            return `[EVENTO: INICIO DE CARRERA]
  La sesión ha pasado a estado "Racing". La carrera está a punto de comenzar o acaba de empezar.

  [INSTRUCCIÓN]: Anuncia el inicio de la carrera. Desea suerte, recuerda concentración en la primera curva. Máximo 2 frases con energía.`;
          }
          if (data.to === 'Checkered' || data.to === 'CoolDown') {
            return `[EVENTO: FIN DE CARRERA]
  La carrera ha terminado.

  [INSTRUCCIÓN]: Felicita al piloto por completar la carrera. Comenta brevemente cómo fue.`;
          }
          return null;

        default:
          return null;
      }
    }

    /**
     * 📝 Formatea mensaje de evento simple (legacy, para sendProactiveMessage)
     */
    private formatRaceEventMessage(eventType: string, data: any, telemetry: TelemetryData): string | null {
      // Este método ya no se usa directamente, pero lo mantenemos por si acaso
      return null;
    }

    /**
     * Helper para formatear tiempos de vuelta localmente
     */
    private formatLapTimeLocal(seconds: number): string {
      if (seconds <= 0) return '--:--.---';
      return seconds.toFixed(3);
    }

    /**
     * 🚨 Detecta situaciones críticas y envía alertas a Gemini
     */
    private checkCriticalAlerts(data: TelemetryData, prev: TelemetryData | null): void {
      if (!this.isSessionReady()) return;
      
      // Fuel alerts disabled by design (strategy-only guidance)
      
      // 🌧️ WEATHER CHANGE (si hay datos de clima)
      // TODO: Agregar cuando tengamos datos de clima
      
      // 💥 DAMAGE SEVERE
      const currentIncidents = data.incidents?.incidentCount ?? data.incidents?.count ?? 0;
      if (currentIncidents > 0 && prev) {
        const prevIncidents = prev.incidents?.incidentCount ?? prev.incidents?.count ?? 0;
        if (currentIncidents > prevIncidents + 2) {
          this.sendCriticalAlert('damage_severe', {
            incidents: currentIncidents,
            message: 'Revisa el estado del coche.'
          });
        }
      }
    }

    /**
     * 📋 SEND SESSION JOINED - Send full participant table to Gemini
     * Called when joining a new session with all drivers' info
     * NOW WITH INSTRUCTIONS TO MAKE GEMINI RESPOND!
     */
    /**
     * 🏁 SESSION JOINED - Sends initial session briefing to Gemini
     * 🔒 GATING: Only sends if data quality is sufficient (no empty briefings)
     */
    public sendSessionJoinedEvent(eventData: {
      sessionType: string;
      sessionName: string;
      trackName: string;
      trackConfig: string;
      trackLength: string;
      carName: string;
      totalDrivers: number;
      classDistribution: Record<string, number>;
      strengthOfField: number;
      weatherDeclaredWet: boolean;
      trackTemp: number;
      airTemp: number;
      standings: Array<{
        position: number;
        carNumber: string;
        userName: string;
        iRating: number;
        license: string;
        carClass: string;
        carName: string;
        fastestTime: number;
        lastTime: number;
        lapsComplete: number;
        incidents: number;
        gapToLeader: number | null;
        reasonOutStr: string;
      }>;
      playerPosition: number;
      playerCarNumber: string;
      playerIRating?: number;
      playerLicense?: string;
    }): void {
      if (!this.isSessionReady()) {
        console.warn('[GeminiLive] ⚠️ Cannot send session_joined: session not ready');
        return;
      }

      // Format the standings table as readable text for Gemini
      const standingsTable = this.formatStandingsTable(eventData.standings);
      
      // Build classes summary
      const classesInfo = Object.entries(eventData.classDistribution)
        .map(([cls, count]) => `${cls}: ${count}`)
        .join(', ');
      
      // Find nearby rivals for context
      const playerPos = eventData.playerPosition;
      // 🔒 UNIFY: Consistent name resolution for nearby rivals
      const getDriverName = (driver: any) => driver?.userName || driver?.name || '?';
      const nearbyRivals = eventData.standings
        .filter(s => Math.abs(s.position - playerPos) <= 3 && s.position !== playerPos)
        .map(s => `P${s.position} ${getDriverName(s)} (${s.iRating}iR, ${s.license})`)
        .join(', ');

      // Calculate average safety rating from licenses
      const licenses = eventData.standings.map(s => s.license);
      const safetyInfo = this.analyzeSafetyRatings(licenses);

      const message = `[NUEVA SESIÓN - BRIEFING REQUERIDO]

  📍 CIRCUITO: ${eventData.trackName}${eventData.trackConfig ? ` (${eventData.trackConfig})` : ''}
  📏 Longitud: ${eventData.trackLength}
  🚗 TU COCHE: ${eventData.carName}
  🏁 Sesión: ${eventData.sessionType} - ${eventData.sessionName}

  📊 NIVEL DE LA SESIÓN:
  - SoF (Strength of Field): ${eventData.strengthOfField}
  - Tu iRating: ${eventData.playerIRating || 'N/A'}
  - Comparativa: ${eventData.playerIRating ? (eventData.strengthOfField > eventData.playerIRating ? 'SoF POR ENCIMA de tu nivel' : 'SoF POR DEBAJO de tu nivel') : 'N/A'}

  👥 PARRILLA: ${eventData.totalDrivers} pilotos
  🏎️ Clases: ${classesInfo}
  📋 TU POSICIÓN: P${eventData.playerPosition} (Coche #${eventData.playerCarNumber})

  🎯 RIVALES CERCANOS: ${nearbyRivals || 'Ninguno cerca'}

  🛡️ SEGURIDAD MEDIA: ${safetyInfo}

  🌡️ CONDICIONES:
  - Pista: ${eventData.trackTemp}°C
  - Aire: ${eventData.airTemp}°C
  - Lluvia: ${eventData.weatherDeclaredWet ? '⚠️ SÍ - PISTA MOJADA' : 'No'}

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  TABLA COMPLETA DE PARTICIPANTES:
  ${standingsTable}
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  [INSTRUCCIÓN]: Da un briefing completo de esta sesión. Tienes TOTAL LIBERTAD para ser creativo:

  📖 NARRATIVA LIBRE:
  - Inventa historias sobre las batallas que se avecinan
  - Crea narrativas sobre rivales ("el piloto X viene en racha", "Y está hambriento de victoria")
  - Describe el contexto dramático (SOF alto = "campo de batalla de élite", baja SR = "carrera sucia esperada")
  - Predice posibles escenarios basándote en los datos
  - Usa metáforas, referencias, dramatismo (sin pasarte, pero sé entretenido)

  📊 ANÁLISIS ESTRATÉGICO:
  1. Nivel de competencia: Analiza SoF vs iRating del piloto y qué significa
  2. Posición de salida y objetivo realista según el campo
  3. Rivales clave: Identifica amenazas (alto iR) y oportunidades (bajo iR cerca)
  4. Condiciones de pista: Temperatura y efecto en estrategia
  5. Si multiclass: Advierte sobre gestión de tráfico

  🎯 OBJETIVO: Que el piloto se sienta EMOCIONADO y PREPARADO, no solo informado.

  NO hay límite de extensión. Puedes hablar 30-45 segundos si hace falta. Estilo: Comentarista F1 + Ingeniero de pista.`;

      // 🔒 GATING: Check data quality before sending session_joined
      // Use real completeness signals (actual standings, not just counts)
      const sanitized = sanitizeTelemetry(this.currentTelemetry || {} as TelemetryData);
      const standings = eventData.standings || [];
      const canSend = canSendSessionJoined(
        sanitized, 
        eventData.totalDrivers, 
        eventData.strengthOfField,
        standings
      );
      
      if (!canSend) {
        console.warn(`[GeminiLive] ⚠️ SKIPPING session_joined: insufficient data quality`);
        console.warn(`  - Total drivers: ${eventData.totalDrivers}`);
        console.warn(`  - Strength of Field: ${eventData.strengthOfField}`);
        console.warn(`  - Standings count: ${standings.length}`);
        console.warn(`  - Track: ${sanitized.session.trackName}`);
        console.warn(`  - Car: ${sanitized.session.carName}`);
        console.warn(`  - Data quality warnings: ${sanitized.quality.warnings.join(', ')}`);
        return; // Don't send empty briefings
      }

      console.log(`[GeminiLive] 📋 SENDING SESSION JOINED BRIEFING: ${eventData.totalDrivers} drivers, SoF ${eventData.strengthOfField}`);

      try {
        this.sendAndLog(
          {
            turns: [
              {
                role: "user",
                parts: [{ text: message }],
              },
            ],
            turnComplete: true, // ⚡ FORCE GEMINI TO RESPOND!
          },
          'session_joined',
          {
            totalDrivers: eventData.totalDrivers,
            strengthOfField: eventData.strengthOfField,
            sessionType: eventData.sessionType
          }
        );
      } catch (error) {
        this.logEntry('error', 'session_joined', `Failed: ${error}`);
        console.error("[GeminiLive] ❌ Failed to send session_joined:", error);
      }
    }

    /**
     * Analyze safety ratings from license strings
     */
    private analyzeSafetyRatings(licenses: string[]): string {
      let rookies = 0, dClass = 0, cClass = 0, bClass = 0, aClass = 0;
      
      for (const lic of licenses) {
        const letter = lic.charAt(0).toUpperCase();
        if (letter === 'R') rookies++;
        else if (letter === 'D') dClass++;
        else if (letter === 'C') cClass++;
        else if (letter === 'B') bClass++;
        else if (letter === 'A') aClass++;
      }
      
      const total = licenses.length;
      if (rookies + dClass > total * 0.4) {
        return `⚠️ CUIDADO - ${rookies + dClass} rookies/D de ${total}. Espera incidentes en T1.`;
      } else if (aClass + bClass > total * 0.6) {
        return `✅ Parrilla limpia - Mayoría A/B license. Carrera segura.`;
      } else {
        return `Mixta - Mezcla de niveles. Atento a los de atrás.`;
      }
    }

    /**
     * Format standings array into a readable table
     */
    /**
     * 🔒 UNIFY: Format standings table with consistent name resolution
     */
    private formatStandingsTable(standings: Array<{
      position: number;
      carNumber: string;
      userName: string;
      name?: string;
      iRating: number;
      license: string;
      carClass: string;
      fastestTime: number;
      lastTime: number;
      lapsComplete: number;
      incidents: number;
      gapToLeader: number | null;
      reasonOutStr: string;
    }>): string {
      const lines: string[] = [];
      
      // 🔒 UNIFY: Use consistent name resolution in standings table
      const getDriverName = (driver: any) => driver?.userName || driver?.name || '?';
      
      for (const entry of standings) {
        const fastestFormatted = entry.fastestTime > 0 
          ? formatTimeForGemini(entry.fastestTime) 
          : '--:--.---';
        const gapFormatted = entry.gapToLeader !== null && entry.gapToLeader > 0
          ? `+${entry.gapToLeader.toFixed(3)}`
          : (entry.position === 1 ? 'LEADER' : '-');
        
        const driverName = getDriverName(entry);
        lines.push(
          `P${entry.position.toString().padStart(2)} | #${entry.carNumber.padStart(3)} | ${driverName.substring(0, 20).padEnd(20)} | ${entry.iRating.toString().padStart(5)}iR | ${entry.license.padEnd(6)} | ${entry.carClass.padEnd(8)} | ${fastestFormatted} | Gap: ${gapFormatted} | Inc: ${entry.incidents} | ${entry.reasonOutStr}`
        );
      }
      
      return lines.join('\n');
    }

    // Store iRacing setup data from setup-extract.py
    private currentSetup: any = null;

    public updateSetup(setup: any) {
      this.currentSetup = setup;
      console.log('[GeminiLive] 📋 Setup updated:', {
        hasCarSetup: !!setup?.carSetup,
        sections: setup?.carSetup ? Object.keys(setup.carSetup) : [],
        updateCount: setup?.updateCount
      });
    }

    public setInitialContext(context: {
      trackName?: string;
      carName?: string;
      sessionType?: string;
    }) {
      this.initialContext = context;
    }

    /**
     * 🔄 Calcula el delay para el próximo intento de reconexión (exponential backoff)
     * 1er intento: 2s (rápido)
     * 2do intento: 5s
     * 3er intento: 10s
     * 4to intento: 20s
     * 5to+ intento: 30s (cap)
     */
    private getRetryDelay(): number {
      if (this.retryCount === 0) return 2000; // Primer intento muy rápido
      if (this.retryCount === 1) return 5000;
      if (this.retryCount === 2) return 10000;
      
      // Exponencial con cap de 30s para intentos posteriores
      const baseDelay = 5000;
      return Math.min(baseDelay * Math.pow(2, this.retryCount - 1), 30000);
    }

    /**
     * 🔄 Intenta reconectar automáticamente después de un error
     */
    private async scheduleReconnection(context: {
      trackName?: string;
      carName?: string;
      sessionType?: string;
    }): Promise<void> {
      if (this.retryCount >= this.maxRetries) {
        console.error(`❌ Max retries (${this.maxRetries}) reached. Giving up on auto-reconnection.`);
        console.error(`   Last error: ${this.lastConnectionError}`);
        return;
      }

      const delay = this.getRetryDelay();
      this.retryCount++;
      
      console.log(`🔄 Scheduling reconnection attempt ${this.retryCount}/${this.maxRetries} in ${delay/1000}s...`);
      
      this.retryTimeout = setTimeout(async () => {
        try {
          console.log(`🔄 Retry attempt ${this.retryCount}/${this.maxRetries} - Connecting to Gemini...`);
          await this.connect(context);
          
          // Si la conexión tuvo éxito, resetear el contador
          console.log("✅ Reconnection successful! Resetting retry counter.");
          this.retryCount = 0;
          this.lastConnectionError = null;
          
          // 🔧 CRÍTICO: Reanudar AudioContext después de reconexión
          // Los navegadores suspenden el AudioContext por políticas de autoplay
          // Debe reanudarse explícitamente tras una reconexión
          if (this.audioContext && this.audioContext.state === 'suspended') {
            console.log("🔊 Resuming AudioContext after reconnection...");
            try {
              await this.audioContext.resume();
              console.log("✅ AudioContext resumed successfully");
            } catch (resumeError) {
              console.warn("⚠️ Failed to resume AudioContext:", resumeError);
              // No crítico - el usuario puede reanudar manualmente con PTT
            }
          }
          
          // 🛡️ P0-FIX2: RECONNECTION WAKE-UP REMOVED
          // Razón: El mensaje puede causar respuestas de audio no deseadas ("dos voces")
          // Gemini funciona correctamente sin este mensaje - el modelo se reactiva con el primer input real
          // await this.sendReconnectionWakeUp();

          // 🔔 Notify hook that we're reconnected
          if (this.onReconnect) {
            console.log("🔔 Notifying reconnect callback...");
            this.onReconnect();
          }
        } catch (error: any) {
          console.error(`❌ Retry attempt ${this.retryCount}/${this.maxRetries} failed:`, error?.message);
          this.lastConnectionError = error?.message || "Unknown error";
          
          // Intentar otra vez si no hemos alcanzado el máximo
          if (this.retryCount < this.maxRetries) {
            await this.scheduleReconnection(context);
          }
        }
      }, delay);
    }

    /**
     * ✨ Genera una clave estable de sesión para detectar cambios REALES
     */
    private generateSessionKey(context: {
      trackName?: string;
      carName?: string;
      sessionType?: string;
      simulator?: string;
    }): string {
      return `${context.simulator || "Unknown"}|${context.sessionType || "Practice"}|${context.trackName || "Unknown Track"}|${context.carName || "Unknown Car"}`;
    }

    /**
     * ✨ Verifica si debe reconectar basándose en cambio real de sesión
     */
    public shouldReconnect(newContext: {
      trackName?: string;
      carName?: string;
      sessionType?: string;
    }): boolean {
      const newKey = this.generateSessionKey(newContext);

      // Si la key no ha cambiado, NO reconectar
      if (newKey === this.sessionKey) {
        return false;
      }

      // Si está vacía la nueva key, NO reconectar
      if (!newKey || newKey === "||") {
        return false;
      }

      // Si ya está conectando o conectado con esta key, NO reconectar
      if (this.isConnecting || (this.isConnected && newKey === this.sessionKey)) {
        return false;
      }

      return true;
    }

    private normalizePromptForPreview(prompt: string): string {
      return prompt.replace(/\s+/g, " ").trim();
    }

    private async computePromptHash(prompt: string): Promise<string> {
      const encoder = new TextEncoder();
      const bytes = encoder.encode(prompt);
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }

    private async buildSystemInstructionMeta(systemInstruction: string): Promise<SystemInstructionMeta> {
      const normalized = this.normalizePromptForPreview(systemInstruction);
      return {
        hash: await this.computePromptHash(systemInstruction),
        length: systemInstruction.length,
        origin: "client/src/services/gemini-system-instruction.ts",
        preview: normalized.slice(0, 300),
      };
    }

    public async connect(initialContext?: {
      trackName?: string;
      carName?: string;
      sessionType?: string;
    }) {
      if (initialContext) {
        this.initialContext = initialContext;
      }

      // 🔒 CRITICAL: Prevent connection if already connected
      if (this.session && this.isConnected) {
        console.log(
          `[GeminiLive] ⏸️ Instance #${this.instanceId}: Already connected, skipping duplicate connection`,
        );
        return;
      }

      // ✨ GUARD: No reconectar si ya está conectando/conectado
      const newKey = this.generateSessionKey(this.initialContext || {});
      if (this.isConnecting) {
        console.log(`[GeminiLive] ⏸️ Instance #${this.instanceId}: Ya conectando, ignorando solicitud duplicada`);
        return;
      }
      if (this.isConnected && newKey === this.sessionKey) {
        console.log(`[GeminiLive] ⏸️ Instance #${this.instanceId}: Ya conectado con esta sesión, ignorando reconexión`);
        return;
      }

      this.isConnecting = true;
      this.sessionKey = newKey;
      this.expectedModelTurns = 0;
      console.log(
        `📍 Gemini Live connection starting... [Instance #${this.instanceId}] [SessionKey:`,
        this.sessionKey,
        "]",
      );

      try {
        const AudioContextClass =
          window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContextClass) {
          throw new Error("AudioContext not supported in this browser");
        }

        console.log("📍 Creating AudioContext (suspended state is OK)...");

        // 🛡️ P1-FIX4: Close old AudioContext before creating new one (prevent memory leak)
        if (this.audioContext) {
          console.log("🔄 Closing existing AudioContext before creating new one...");
          try {
            await this.audioContext.close();
            console.log("✅ Old AudioContext closed successfully");
          } catch (closeError) {
            console.warn("⚠️ Failed to close old AudioContext:", closeError);
          }
        }

        // ✨ Dejamos que el sistema elija la mejor sample rate (48kHz o 44.1kHz típicamente)
        // Forzar 24000 causa conflictos con el hardware
        this.audioContext = new AudioContextClass();

        console.log("✅ AudioContext created:", {
          state: this.audioContext.state,
          sampleRate: this.audioContext.sampleRate,
        });

        // Setup Radio FX Chain
        console.log("📍 Setting up radio effects...");
        this.setupRadioEffects();
        console.log("✅ Radio effects chain ready");

        console.log("✅ Audio output ready (microphone will be requested on PTT)");
      } catch (error) {
        console.error("❌ Failed to initialize audio:", error);
        throw error;
      }

      // Now connect to Gemini Live (audio is ready, but context is suspended)
      try {
        console.log("📍 Connecting to Gemini Live...");

        // Build system instruction using centralized builder
        const simulator = this.currentTelemetry?.simulator || this.initialContext?.simulator || 'Unknown';
        const systemInstruction = buildSystemInstruction(simulator, this.initialContext);
        let systemInstructionMeta: SystemInstructionMeta | null = null;

        try {
          systemInstructionMeta = await this.buildSystemInstructionMeta(systemInstruction);

          // 📝 Log FULL system instruction (for debugging)
          this.logEntry('event', 'system_instruction', systemInstruction, {
            hash: systemInstructionMeta.hash,
            length: systemInstructionMeta.length,
            model: 'unknown', // Will be updated after bridge config is received
          });

          // Keep metadata log for summary
          this.logEntry('event', 'system_instruction_meta', `System prompt hash: ${systemInstructionMeta.hash}`, {
            ...systemInstructionMeta,
          });
          console.log('[GeminiLive] 🧾 System prompt metadata', systemInstructionMeta);
        } catch (error) {
          console.warn('[GeminiLive] ⚠️ Failed to generate system prompt metadata:', error);
        }

        const bridgeUrl = 'ws://localhost:8081/gemini';
        this.bridgeSessionConfig = null;
        await new Promise<void>((resolve, reject) => {
          const toLiveServerMessage = (payload: any): LiveServerMessage | null => {
            if (!payload || typeof payload !== 'object') return null;
            if (payload.type === 'model_audio') {
              return {
                serverContent: {
                  modelTurn: { parts: [{ inlineData: { data: payload.data } }] },
                },
              } as any;
            }
            if (payload.type === 'model_text') {
              return {
                serverContent: {
                  modelTurn: { parts: [{ text: payload.text }] },
                },
              } as any;
            }
            if (payload.type === 'model_turn_complete') {
              return { serverContent: { turnComplete: true } } as any;
            }
            if (payload.type === 'tool_call') {
              return { toolCall: payload.toolCall } as any;
            }
            if (payload.type === 'grounding') {
              return { serverContent: { groundingMetadata: payload.metadata } } as any;
            }
            return null;
          };

          if (this.bridgeWs && this.bridgeWs.readyState === WebSocket.OPEN) {
            try {
              this.bridgeWs.close(1000, 'Reconnect');
            } catch {}
          }

          const ws = new WebSocket(bridgeUrl);
          this.bridgeWs = ws;
          this.wsReadyState = this.WS_CONNECTING;
          this.isSessionFullyReady = false;

          const sendJson = (data: any) => {
            ws.send(JSON.stringify(data));
          };

          const bridgeSession: any = {
            _ws: ws,
            sendRealtimeInput: (input: any) => {
              if (input?.media?.mimeType && input?.media?.data) {
                sendJson({ type: 'audio_chunk', mimeType: input.media.mimeType, data: input.media.data });
                return;
              }
              if (input?.audioStreamEnd) {
                sendJson({ type: 'audio_end' });
                return;
              }
            },
            sendClientContent: (content: any) => {
              sendJson({ type: 'client_content', content });
            },
            sendToolResponse: (payload: any) => {
              sendJson({ type: 'tool_response', functionResponses: payload?.functionResponses || [] });
            },
            close: () => {
              try {
                ws.close(1000, 'Client disconnect');
              } catch {}
            }
          };

          let didResolve = false;

          ws.onopen = () => {
            this.wsReadyState = this.WS_OPEN;
            const setupPayload: Record<string, any> = { type: 'setup', systemInstruction };
            if (systemInstructionMeta) {
              setupPayload.systemInstructionMeta = systemInstructionMeta;
            }
            sendJson(setupPayload);
          };

          ws.onmessage = (event) => {
            let payload: any = null;
            try {
              payload = JSON.parse(event.data);
            } catch {
              return;
            }

            if (payload?.type === 'session_config') {
              this.bridgeSessionConfig = {
                model: payload.model || '(unknown)',
                ragEnabled: !!payload.ragEnabled,
                retrievalAttached: !!payload.retrievalAttached,
                location: payload.location || '(unknown)',
                projectIdMasked: payload.projectIdMasked || '(unknown)',
              };
              this.logEntry('event', 'session_config', `Bridge config: model=${this.bridgeSessionConfig.model}`, {
                ...this.bridgeSessionConfig,
              });
              console.log('[GeminiLive] ⚙️ Bridge session config:', this.bridgeSessionConfig);
              return;
            }

            if (payload?.type === 'connected') {
              if (!didResolve) {
                this.session = bridgeSession;
                this.isConnecting = false;
                this.isConnected = true;
                this.isSessionFullyReady = true;
                didResolve = true;
                resolve();
              }
              return;
            }

            if (payload?.type === 'error') {
              const errMsg = payload?.error || 'Bridge error';
              this.lastConnectionError = errMsg;
              if (!didResolve) {
                reject(new Error(errMsg));
              }
              return;
            }

            const liveMsg = toLiveServerMessage(payload);
            if (liveMsg) {
              this.handleMessage(liveMsg);
            }
          };

          ws.onclose = (closeEvent: any) => {
            this.wsReadyState = this.WS_CLOSED;

            const now = Date.now();
            const sessionDuration = this.connectionMetrics.connectionStartTime > 0
              ? (now - this.connectionMetrics.connectionStartTime) / 1000
              : 0;

            this.connectionMetrics.totalDisconnections++;
            this.connectionMetrics.lastDisconnectTime = now;
            this.connectionMetrics.lastDisconnectReason = closeEvent?.reason || 'No reason provided';
            this.connectionMetrics.lastDisconnectCode = closeEvent?.code || 0;
            this.connectionMetrics.wasLastDisconnectClean = closeEvent?.wasClean || false;

            if (sessionDuration > this.connectionMetrics.longestSessionDuration) {
              this.connectionMetrics.longestSessionDuration = sessionDuration;
            }

            console.error('⚠️ Gemini Live Closed (bridge WebSocket)');
            console.error('⚠️ Close Details:', {
              code: closeEvent?.code,
              reason: closeEvent?.reason,
              wasClean: closeEvent?.wasClean,
              sessionDuration: `${sessionDuration.toFixed(1)}s`,
            });

            this.cleanupAudioPipeline();
            this.isSessionFullyReady = false;
            this.isConnected = false;
            this.bridgeSessionConfig = null;

            if (this.onDisconnect) {
              this.onDisconnect();
            }

            if (!didResolve) {
              reject(new Error(closeEvent?.reason || 'Bridge closed before ready'));
              return;
            }

            if (this.initialContext && !this.isConnecting) {
              this.scheduleReconnection(this.initialContext);
            }
          };

          ws.onerror = () => {
            this.connectionMetrics.totalErrors++;
          };
        });
        console.log(
          "✅ Session established successfully [SessionKey:",
          this.sessionKey,
          "]",
        );
        console.log("📊 Session object:", {
          type: typeof this.session,
          keys: Object.keys(this.session || {}),
        });

        // ✨ Marcar como conectado exitosamente
        this.isConnecting = false;
        this.isConnected = true;
        this.lastTurnTime = new Date(); // Reset turn timer
        
        // 📊 Actualizar métricas de conexión
        this.connectionMetrics.totalConnections++;
        this.connectionMetrics.connectionStartTime = Date.now();
        
        // Reset retry counter on successful connection
        this.retryCount = 0;
        this.lastConnectionError = null;
        if (this.retryTimeout) {
          clearTimeout(this.retryTimeout);
          this.retryTimeout = null;
        }

        // 🔒 ONLINE: Start semantic keep-alive to survive long sessions
        this.startKeepAlive();
        
        // ⏰ PROACTIVE RECONNECT: Re-enabled with silent reconnection
        // Gemini Live has a 10-minute session limit, we reconnect at 9 minutes
        // Now uses silent reconnection (turnComplete: false) to avoid "ya estamos aquí"
        this.startProactiveReconnectTimer();
        
        // 📊 CONTEXT: Periodic updates handled by sendContextUpdate() throttling
        
        // �🔄 Procesar mensajes proactivos pendientes
        this.processPendingProactiveMessages();

        // NOTE: Do NOT send dummy audio - Gemini Live closes idle sessions
        // Connection will be maintained by real audio stream from startRecording()
      } catch (error: any) {
        console.error(
          "❌ Failed to connect to Gemini Live (caught exception):",
          error,
        );
        console.error("❌ Exception Details:", {
          message: error?.message,
          stack: error?.stack,
          code: error?.code,
          fullError: JSON.stringify(error, null, 2),
        });
        this.isConnecting = false;
        this.isConnected = false;
        this.lastConnectionError = error?.message || "Unknown connection error";
        
        // 🔄 Intentar reconexión automática si tenemos contexto válido
        if (initialContext && (initialContext.trackName || initialContext.carName)) {
          console.log("🔄 Scheduling automatic reconnection after connection failure...");
          await this.scheduleReconnection(initialContext);
        } else {
          throw error;
        }
      }
    }

    // ✨ OLD: This is no longer needed since we initialize everything on connect()
    // Keeping for reference but could be deleted
    /*
      private async initializeAudio() {
          ...
      }
      */

    private setupRadioEffects() {
      if (!this.audioContext) {
        console.error("❌ setupRadioEffects: audioContext is null!");
        throw new Error("AudioContext not initialized");
      }

      console.log("🎙️ Setting up radio effects chain...");
      // Parámetros sintonizados para sonar como un ingeniero de F1 por radio
      // (similar a CrewChief, pero con Fran hablando español)

      // Create Nodes
      this.radioBus = this.audioContext.createGain(); // Entry point
      const highPass = this.audioContext.createBiquadFilter();
      const lowPass = this.audioContext.createBiquadFilter();
      const distortion = this.audioContext.createWaveShaper();
      const compressor = this.audioContext.createDynamicsCompressor();
      const finalGain = this.audioContext.createGain();
      this.playbackGain = this.audioContext.createGain();

      // 1. High Pass (Cut mud/bass - but not too much)
      highPass.type = "highpass";
      highPass.frequency.value = 350; // Menos agresivo que 300
      highPass.Q.value = 0.5; // Menos pendiente

      // 2. Low Pass (Cut crispness - F1 radio style)
      lowPass.type = "lowpass";
      lowPass.frequency.value = 3000; // Más estrecho para sonido más "radio"
      lowPass.Q.value = 0.5;

      // 3. Distortion (Moderate - F1 radio grit)
      distortion.curve = this.makeDistortionCurve(30); // Más distorsión para radio característico
      distortion.oversample = "2x";

      // 4. Compression (Moderate - not extreme)
      compressor.threshold.value = -30; // Menos sensible
      compressor.knee.value = 40;
      compressor.ratio.value = 4; // Menos extremo (era 8)
      compressor.attack.value = 0.01;
      compressor.release.value = 0.25;

      // 5. Makeup Gain (Just to compensate, not boost)
      finalGain.gain.value = 1.2; // Menos ganancia (era 2.0)
      this.playbackGain.gain.value = 1.0;

      // Connect Chain: Bus -> HP -> LP -> Dist -> Comp -> Gain -> PlaybackGain -> Out
      this.radioBus.connect(highPass);
      highPass.connect(lowPass);
      lowPass.connect(distortion);
      distortion.connect(compressor);
      compressor.connect(finalGain);
      finalGain.connect(this.playbackGain);
      this.playbackGain.connect(this.audioContext.destination);
    }

    // Helper for distortion curve
    private makeDistortionCurve(amount: number) {
      const k = typeof amount === "number" ? amount : 50;
      const n_samples = 44100;
      const curve = new Float32Array(n_samples);
      const deg = Math.PI / 180;

      for (let i = 0; i < n_samples; ++i) {
        const x = (i * 2) / n_samples - 1;
        curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
      }
      return curve;
    }

    /**
     * OPTIMIZATION: Setup audio input using AudioWorklet (preferred) or ScriptProcessor (fallback)
     * AudioWorklet processes audio in a separate thread, reducing main thread CPU usage
     */
    private async setupAudioInput() {
      if (!this.audioContext || !this.stream) {
        console.error("❌ setupAudioInput: audioContext or stream is null!");
        console.error("  audioContext state:", this.audioContext?.state);
        console.error("  stream:", this.stream ? "exists" : "null");
        throw new Error("AudioContext or stream not initialized");
      }

      if (this.audioContext.state === "closed") {
        console.error(
          "❌ setupAudioInput: AudioContext is CLOSED! Cannot setup audio input.",
        );
        throw new Error("AudioContext is closed");
      }

      console.log("🎙️ Setting up audio input...");
      console.log("  AudioContext state:", this.audioContext.state);

      try {
        this.inputSource = this.audioContext.createMediaStreamSource(this.stream);
        console.log("✅ MediaStreamAudioSourceNode created");
      } catch (e) {
        console.error("❌ Failed to create MediaStreamAudioSourceNode:", e);
        throw e;
      }

      // OPTIMIZATION: Try AudioWorklet first, fallback to ScriptProcessor
      if (this.useAudioWorklet && 'audioWorklet' in this.audioContext) {
        try {
          await this.setupAudioWorklet();
          console.log("✅ Audio input ready (AudioWorklet - off main thread)");
          return;
        } catch (e) {
          console.warn("⚠️ AudioWorklet failed, falling back to ScriptProcessor:", e);
          this.useAudioWorklet = false;
        }
      }

      // Fallback: ScriptProcessor (deprecated but widely supported)
      this.setupScriptProcessor();
      console.log("✅ Audio input ready (ScriptProcessor - main thread)");
    }

    /**
     * OPTIMIZATION: Setup AudioWorklet for off-main-thread audio processing
     */
    private async setupAudioWorklet() {
      if (!this.audioContext || !this.inputSource) {
        throw new Error("AudioContext or inputSource not initialized");
      }

      // Load the AudioWorklet module
      await this.audioContext.audioWorklet.addModule('/audio-processor.js');
      console.log("✅ AudioWorklet module loaded");

      // Create the worklet node
      this.workletNode = new AudioWorkletNode(this.audioContext, 'gemini-audio-processor');
      console.log("✅ AudioWorkletNode created");

      let frameCount = 0;

      // Handle messages from the worklet (audio data)
      this.workletNode.port.onmessage = (event) => {
        if (event.data.type !== 'audio') return;
        
        // 🔒 P0 INPUT LOCK: Drop audio frames during tool execution
        if (this.inputLock || !this.isSessionReady()) {
          // Drop audio frames during tool execution
          // Log periodically (every 100 frames) to avoid spam
          if (!this.audioDropCounter) this.audioDropCounter = 0;
          this.audioDropCounter++;
          if (this.audioDropCounter % 100 === 0) {
            console.log(`🔇 Audio frames dropped: ${this.audioDropCounter} (input locked)`);
          }
          return;
        }
        
        // Reset counter when not locked
        if (this.audioDropCounter > 0) {
          console.log(`🔊 Audio resumed after dropping ${this.audioDropCounter} frames`);
          this.audioDropCounter = 0;
        }
        
        // 🔒 GUARD: Only send audio if session is ready
        if (!this.isRecording) return;

        const inputData = event.data.buffer as Float32Array;

        // Process audio (downsample and encode)
        const downsampledData = this.downsampleBuffer(
          inputData,
          this.audioContext!.sampleRate,
          16000,
        );

        const pcmData = this.floatTo16BitPCM(downsampledData);
        const base64Audio = this.arrayBufferToBase64(pcmData);

        frameCount++;
        if (frameCount % 100 === 0) {
          console.log(
            "[AUDIO-IN/Worklet] Frame " + frameCount + " sent (" + Math.round(base64Audio.length / 1024) + "kb)",
          );
        }

        try {
          this.hasAudioThisTurn = true;
          this.session.sendRealtimeInput({
            media: {
              mimeType: "audio/pcm;rate=16000",
              data: base64Audio,
            },
          });
        } catch (err) {
          console.error("❌ Error sending audio frame:", err);
          this.stopRecording();
        }
      };

      // Connect the audio graph
      this.inputSource.connect(this.workletNode);
      
      // Keep the graph alive with a mute gain (required for some browsers)
      const muteGain = this.audioContext.createGain();
      muteGain.gain.value = 0;
      this.workletNode.connect(muteGain);
      muteGain.connect(this.audioContext.destination);
    }

    /**
     * Fallback: Setup ScriptProcessor for audio processing (deprecated but compatible)
     */
    private setupScriptProcessor() {
      if (!this.audioContext || !this.inputSource) {
        throw new Error("AudioContext or inputSource not initialized");
      }

      try {
        this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
        console.log("✅ ScriptProcessorNode created (fallback)");
      } catch (e) {
        console.error("❌ Failed to create ScriptProcessorNode:", e);
        throw e;
      }

      // Keep the graph alive with a mute gain
      const muteGain = this.audioContext.createGain();
      muteGain.gain.value = 0;
      this.processor.connect(muteGain);
      muteGain.connect(this.audioContext.destination);

      let frameCount = 0;

      this.processor.onaudioprocess = (e) => {
        // 🔒 P0 INPUT LOCK: Drop audio frames during tool execution
        if (this.inputLock || !this.isSessionReady()) {
          // Drop audio frames during tool execution
          // Log periodically (every 100 frames) to avoid spam
          if (!this.audioDropCounter) this.audioDropCounter = 0;
          this.audioDropCounter++;
          if (this.audioDropCounter % 100 === 0) {
            console.log(`🔇 Audio frames dropped: ${this.audioDropCounter} (input locked)`);
          }
          return;
        }
        
        // Reset counter when not locked
        if (this.audioDropCounter > 0) {
          console.log(`🔊 Audio resumed after dropping ${this.audioDropCounter} frames`);
          this.audioDropCounter = 0;
        }
        
        // 🔒 GUARD: Only send audio if session is ready
        if (!this.isRecording) return;

        const inputData = e.inputBuffer.getChannelData(0);

        const downsampledData = this.downsampleBuffer(
          inputData,
          this.audioContext!.sampleRate,
          16000,
        );

        const pcmData = this.floatTo16BitPCM(downsampledData);
        const base64Audio = this.arrayBufferToBase64(pcmData);

        frameCount++;
        if (frameCount % 100 === 0) {
          console.log(
            "[AUDIO-IN/ScriptProc] Frame " + frameCount + " sent (" + Math.round(base64Audio.length / 1024) + "kb)",
          );
        }

        try {
          this.hasAudioThisTurn = true;
          this.session.sendRealtimeInput({
            media: {
              mimeType: "audio/pcm;rate=16000",
              data: base64Audio,
            },
          });
        } catch (err) {
          console.error("❌ Error sending audio frame:", err);
          this.stopRecording();
        }
      };
    }

    private async handleMessage(message: LiveServerMessage) {
      // 🔒 READY GATE: Confirm session is fully ready on first message (CHANGE 2)
      if (!this.isSessionFullyReady) {
        this.isSessionFullyReady = true;
        console.log("✅ Session fully ready - first server message received");
        console.log("🔓 Ready gate opened - audio/telemetry/context updates now allowed");
      }
      
      // 🔒 ONLINE: Update turn time on any message (keeps session alive)
      this.lastTurnTime = new Date();
      
      // 🔧 FIX: Track response reception to avoid message pile-up
      this.lastResponseTime = Date.now();
      this.isWaitingForResponse = false;

      // 0. Check for server errors
      if ((message as any).error) {
        console.error("❌ Server Error in message:", (message as any).error);
      }

      if (message.serverContent?.modelTurn?.parts) {
        const parts = message.serverContent.modelTurn.parts;
        const hasAudio = parts.some((p: any) => p.inlineData?.data);
        const hasText = parts.some((p: any) => p.text);
        const hasFunctionCall = parts.some((p: any) => p.functionCall);
        if (hasAudio || hasText || hasFunctionCall) {
          // console.log('📨 [MSG] Audio:', hasAudio, 'Text:', hasText, 'FnCall:', hasFunctionCall);
        }
      }

      // 1. Tool Calls (The correct way to handle context)
      if (message.toolCall) {
        console.log("🔧 Tool Call detected");
        const toolNames = Array.isArray(message.toolCall.functionCalls)
          ? message.toolCall.functionCalls.map((fc: any) => fc?.name).filter(Boolean).join(', ')
          : 'unknown';
        this.logEntry('tool', 'tool_call', toolNames, {
          turnComplete: !!message.serverContent?.turnComplete
        });
        this.handleToolCall(message.toolCall);
      }

      // 2. Audio Output
      const audioData =
        message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
      if (audioData) {
        this.onSpeakingStateChange(true);
        // 📥 LOG: registrar audio recibido (aunque no tengamos transcript)
        this.logEntry('received', 'gemini_audio', '[AUDIO DATA]', {
          bytes: (typeof audioData === 'string') ? audioData.length : undefined,
          turnComplete: !!message.serverContent?.turnComplete
        });
        await this.playAudioChunk(audioData);
      }

      // 3. Transcript (Optional) - Extract text for UI
      const textContent = message.serverContent?.modelTurn?.parts?.find(
        (p: any) => p.text,
      );

      // 📝 LOG: Registrar TODAS las respuestas (text + audio-only)
      const responseContent = textContent?.text || '[Audio-only response]';
      this.logEntry('received', 'gemini_response', responseContent, {
        hasAudio: !!audioData,
        hasText: !!textContent?.text,
        turnComplete: !!message.serverContent?.turnComplete,
        timestamp: Date.now(),
      });

      if (textContent?.text) {
        this.onTranscriptUpdate(textContent.text, true);
      }

      const groundingMetadata = message.serverContent?.groundingMetadata as any;
      if (groundingMetadata) {
        const ragEnabled = this.bridgeSessionConfig?.ragEnabled;
        const retrievalAttached = this.bridgeSessionConfig?.retrievalAttached;
        const chunks = Array.isArray(groundingMetadata.groundingChunks)
          ? groundingMetadata.groundingChunks
          : [];
        const chunkTitles = chunks
          .map((c: any) => c?.retrievedContext?.title || c?.retrievedContext?.uri || c?.web?.title || c?.web?.uri)
          .filter(Boolean)
          .slice(0, 5);
        let groundingCategory = 'grounding';
        let groundingSummary = `RAG grounding: ${chunks.length} chunk(s)`;

        if (ragEnabled === false) {
          groundingCategory = 'grounding_disabled';
          groundingSummary = `grounding metadata (RAG desactivado): ${chunks.length} chunk(s)`;
        } else if (chunks.length === 0) {
          groundingCategory = 'grounding_empty';
          groundingSummary = 'RAG grounding vacío: 0 chunk(s)';
        }

        this.logEntry(
          'event',
          groundingCategory,
          groundingSummary,
          {
            chunks: chunks.length,
            top: chunkTitles,
            ragEnabled,
            retrievalAttached,
            groundingMetadata,
          },
        );
      }

      // 4. Turn Complete
      if (message.serverContent?.turnComplete) {
        if (this.expectedModelTurns > 0) {
          this.expectedModelTurns--;
        }
        setTimeout(() => this.onSpeakingStateChange(false), 800);
      }

      if (message.serverContent?.interrupted) {
        console.log("⚠️ Interrupted");
        this.stopAudioPlaybackWithFade();
      }
    }

    private async handleToolCall(toolCall: any) {
      // 🔒 P0 INPUT LOCK: Lock inputs during tool execution
      this.setExecutionState(true); // 🔒 LOCK INPUT
      
      // 🔍 MONITORING: Log state after lock
      this.logLockState('Tool execution started');
      
      try {
        // 🔒 GUARD: Verify session is still active before processing tool calls
        if (!this.isSessionReady()) {
          console.error(`[GeminiLive] ❌ Instance #${this.instanceId}: Cannot process tool call - session not ready`);
          return;
        }

        for (const fc of toolCall.functionCalls) {
        console.log("[TOOL] " + fc.name + " called");

        // 🔒 GUARD: Re-check session before each tool response
        if (!this.session) {
          console.error(`[GeminiLive] ❌ Session lost during tool processing for ${fc.name}`);
          return;
        }

        // 📝 LOG: Registrar tool call
        this.logEntry('tool', fc.name, `Tool called: ${fc.name}`, { functionCall: fc });

        // 🔒 GLOBAL TRY-CATCH: Prevent any tool error from killing the connection
        try {

        if (fc.name === "get_session_context") {
          console.log('[GEMINI TOOL] get_session_context llamado. Telemetría actual:', {
            trackName: this.currentTelemetry?.session?.trackName,
            carName: this.currentTelemetry?.session?.carName,
            sessionType: this.currentTelemetry?.session?.type,
            position: this.currentTelemetry?.position?.overall,
            lastLapTime: this.currentTelemetry?.timing?.lastLapTime,
            isNull: this.currentTelemetry === null
          });
          const sessionContext = createSessionContext(this.currentTelemetry);
          
          // 🔧 FORMAT TIME FOR GEMINI: Simplificar todo a segundos con 3 decimales
          const formattedContext = {
            ...sessionContext,
            timing: {
              ...sessionContext.timing,
              lastLapTime: formatTimeForGemini(sessionContext.timing.lastLapTime),
              bestLapTime: formatTimeForGemini(sessionContext.timing.bestLapTime),
              deltaToBest: sessionContext.timing.deltaToBest ? sessionContext.timing.deltaToBest.toFixed(3) : null,
              deltaToSessionBest: sessionContext.timing.deltaToSessionBest ? sessionContext.timing.deltaToSessionBest.toFixed(3) : null,
            },
            race: {
              ...sessionContext.race,
              gapAhead: sessionContext.race.gapAhead ? sessionContext.race.gapAhead.toFixed(3) : null,
              gapBehind: sessionContext.race.gapBehind ? sessionContext.race.gapBehind.toFixed(3) : null,
              gapToLeader: sessionContext.race.gapToLeader ? sessionContext.race.gapToLeader.toFixed(3) : null,
            },
            session: {
              ...sessionContext.session,
              estLapTime: sessionContext.session.estLapTime > 0 ? sessionContext.session.estLapTime.toFixed(3) : "N/A",
            },
            standings: sessionContext.standings.map(s => ({
              ...s,
              fastestTime: formatTimeForGemini(s.fastestTime),
              lastTime: formatTimeForGemini(s.lastTime),
              gapToLeader: (typeof s.gapToLeader === 'number') ? s.gapToLeader.toFixed(3) : null,
            }))
          };

          console.log('[SessionContext] Generated (Formatted):', {
            lastLap: formattedContext.timing.lastLapTime,
            bestLap: formattedContext.timing.bestLapTime,
            position: formattedContext.race.position,
            gapAhead: formattedContext.race.gapAhead,
            track: formattedContext.session.trackName,
            car: formattedContext.session.carName
          });
          
          // 📝 LOG: Registrar tool response CON DATOS COMPLETOS
          this.logEntry('tool', 'get_session_context_response', 
            `Returning timing data: last=${formattedContext.timing.lastLapTime}, best=${formattedContext.timing.bestLapTime}, pos=${formattedContext.race.position}/${formattedContext.race.totalCars}`,
            { sessionContext: formattedContext }
          );
          
          this.session.sendToolResponse({
            functionResponses: [
              {
                id: fc.id,
                name: fc.name,
                response: { result: formattedContext },
              },
            ],
          });
        } else if (fc.name === "get_vehicle_setup") {
          let result = this.getVehicleSetup();

          // If setup hasn't been received yet, try to pull the cached snapshot from backend
          // (prevents missing setup when it arrived before GeminiLiveService initialized)
          if (!result.setup) {
            try {
              const setupPayload = await this.requestLatestSetupViaWs();
              if (setupPayload && setupPayload.carSetup) {
                this.updateSetup(setupPayload);
                result = this.getVehicleSetup();
              }
            } catch (e) {
              console.warn('[VehicleSetup] Failed to refresh setup via WS:', e);
            }
          }
          console.log('[VehicleSetup] Generated:', {
            car: result.car?.name,
            track: result.track?.name,
            hasSetup: !!result.setup,
            setupSections: result.setup ? Object.keys(result.setup) : [],
          });

          // 📝 LOG: Tool response
          this.logEntry('received', 'tool_response',
            `get_vehicle_setup response: car=${result.car?.name}, track=${result.track?.name}, hasSetup=${!!result.setup}`,
            { toolName: 'get_vehicle_setup', result }
          );

          this.session.sendToolResponse({
            functionResponses: [
              {
                id: fc.id,
                name: fc.name,
                response: { result: result },
              },
            ],
          });
        } else if (fc.name === "get_recent_events") {
          const events = this.recentEventsBuffer.slice(-20).map(e => ({
            type: e.type,
            message: e.message,
            priority: e.priority,
            timeAgo: Math.floor((Date.now() - e.timestamp) / 1000) + 's ago',
          }));
          
          console.log('[RecentEvents] Returned:', {
            count: events.length,
            types: events.map(e => e.type),
          });

          // 📝 LOG: Tool response
          this.logEntry('received', 'tool_response',
            `get_recent_events response: ${events.length} events (${events.map(e => e.type).join(', ')})`,
            { toolName: 'get_recent_events', eventCount: events.length, events }
          );

          this.session.sendToolResponse({
            functionResponses: [
              {
                id: fc.id,
                name: fc.name,
                response: { result: { events } },
              },
            ],
          });
        } else if (fc.name === "request_current_setup") {
          console.log('[RequestSetup] Requesting fresh setup from backend...');
          
          // Pull cached setup snapshot via WebSocket for immediate response
          try {
            const setupPayload = await this.requestLatestSetupViaWs();
            if (setupPayload && setupPayload.carSetup) {
              this.updateSetup(setupPayload);
            } else {
              console.warn('[RequestSetup] No setup available yet (payload empty)');
            }
          } catch (e) {
            console.warn('[RequestSetup] Failed to request latest setup:', e);
          }
          
          // Obtener el setup (ahora debería estar actualizado)
          const result = this.getVehicleSetup();
          console.log('[RequestSetup] Setup retrieved:', {
            car: result.car?.name,
            track: result.track?.name,
            hasSetup: !!result.setup,
            setupSections: result.setup ? Object.keys(result.setup) : [],
          });

          // 📝 LOG: Tool response
          this.logEntry('received', 'tool_response',
            `request_current_setup response: car=${result.car?.name}, track=${result.track?.name}, hasSetup=${!!result.setup}`,
            { toolName: 'request_current_setup', result }
          );

          this.session.sendToolResponse({
            functionResponses: [
              {
                id: fc.id,
                name: fc.name,
                response: { result: result },
              },
            ],
          });
        } else if (fc.name === "compare_laps") {
          // Handle lap comparison tool
          const lap1Ref = fc.args?.lap1 || 'session_best';
          const lap2Ref = fc.args?.lap2 || 'last';
          
          console.log(`[CompareLaps] Comparing ${lap1Ref} vs ${lap2Ref}...`);
          
          try {
            const result = await lapComparison.compare(lap1Ref, lap2Ref);
            
            if (result.success && result.imageBase64) {
              console.log('[CompareLaps] Image generated successfully');

              // 📝 LOG: Tool response (SUCCESS)
              this.logEntry('received', 'tool_response',
                `compare_laps response: SUCCESS - lap ${result.metadata?.lap1Number} vs lap ${result.metadata?.lap2Number}`,
                { toolName: 'compare_laps', success: true, metadata: result.metadata }
              );

              // ✅ ALWAYS send tool response first (critical for Gemini)
              this.session.sendToolResponse({
                functionResponses: [
                  {
                    id: fc.id,
                    name: fc.name,
                    response: {
                      result: {
                        success: true,
                        message: 'Comparison image generated',
                        metadata: result.metadata,
                      }
                    },
                  },
                ],
              });
              
              // Then try to send the image (best effort - don't fail if this errors)
              try {
                if (!this.isSessionReady()) {
                  console.warn('[CompareLaps] ⚠️ Session not ready, skipping image send (tool response already sent)');
                  return;
                }
                
                const analysisPrompt = lapComparison.getAnalysisPrompt(result);
                const base64Data = result.imageBase64.split(',')[1];
                
                // Check image size
                const imageSizeKB = Math.round(base64Data.length * 0.75 / 1024);
                console.log(`[CompareLaps] Image size: ${imageSizeKB}KB`);
                
                if (imageSizeKB > 4000) {
                  console.warn('[CompareLaps] ⚠️ Image too large (>4MB), skipping visual analysis');
                  return;
                }
                
                this.sendAndLog(
                  {
                    turns: [
                      {
                        role: "user",
                        parts: [
                          {
                            inlineData: {
                              mimeType: "image/png",
                              data: base64Data,
                            }
                          },
                          {
                            text: analysisPrompt,
                          }
                        ],
                      },
                    ],
                    turnComplete: true,
                  },
                  'lap_comparison_image',
                  { lap1: lap1Ref, lap2: lap2Ref, imageSizeKB }
                );
                
                console.log('[CompareLaps] ✅ Image sent to Gemini for analysis');
              } catch (sendErr) {
                console.warn('[CompareLaps] ⚠️ Image send failed (but tool response was sent):', sendErr);
                // Not critical - tool response was already sent
              }
            } else {
              console.warn('[CompareLaps] Failed:', result.error);

              // 📝 LOG: Tool response (ERROR)
              this.logEntry('received', 'tool_response',
                `compare_laps response: ERROR - ${result.error}`,
                { toolName: 'compare_laps', success: false, error: result.error }
              );

              this.session.sendToolResponse({
                functionResponses: [
                  {
                    id: fc.id,
                    name: fc.name,
                    response: {
                      result: {
                        success: false,
                        error: result.error || 'No laps available. Complete some laps first.',
                      }
                    },
                  },
                ],
              });
            }
          } catch (error) {
            console.error('[CompareLaps] Error:', error);

            // 📝 LOG: Tool response (EXCEPTION)
            this.logEntry('received', 'tool_response',
              `compare_laps response: EXCEPTION - ${(error as Error).message}`,
              { toolName: 'compare_laps', success: false, error: (error as Error).message }
            );

            // ✅ ALWAYS send error response to Gemini
            try {
              this.session.sendToolResponse({
                functionResponses: [
                  {
                    id: fc.id,
                    name: fc.name,
                    response: {
                      result: {
                        success: false,
                        error: (error as Error).message,
                      }
                    },
                  },
                ],
              });
            } catch (responseErr) {
              console.error('[CompareLaps] ❌ Failed to send error response:', responseErr);
            }
          }
        } else if (fc.name === "configure_pit_stop") {
          // Handle pit stop configuration
          const { action, fuelAmount, tires } = fc.args || {};
          console.log(`[ConfigurePitStop] Action: ${action}, Fuel: ${fuelAmount}, Tires: ${tires}`);
          
          try {
            const result = await this.sendPitCommand(action, fuelAmount, tires);

            // 📝 LOG: Tool response
            this.logEntry('received', 'tool_response',
              `configure_pit_stop response: action=${action}, fuel=${fuelAmount}, tires=${tires}`,
              { toolName: 'configure_pit_stop', result }
            );

            this.session.sendToolResponse({
              functionResponses: [
                {
                  id: fc.id,
                  name: fc.name,
                  response: { result },
                },
              ],
            });
          } catch (error) {
            console.error('[ConfigurePitStop] Error:', error);

            // 📝 LOG: Tool response (ERROR)
            this.logEntry('received', 'tool_response',
              `configure_pit_stop response: ERROR - ${(error as Error).message}`,
              { toolName: 'configure_pit_stop', success: false, error: (error as Error).message }
            );

            this.session.sendToolResponse({
              functionResponses: [
                {
                  id: fc.id,
                  name: fc.name,
                  response: {
                    result: {
                      success: false,
                      error: (error as Error).message,
                    }
                  },
                },
              ],
            });
          }
        } else if (fc.name === "get_pit_status") {
          // Get current pit stop configuration
          console.log('[GetPitStatus] Requesting pit status...');
          
          try {
            const result = await this.getPitStatus();
            console.log('[GetPitStatus] Result:', result);

            // 📝 LOG: Tool response
            this.logEntry('received', 'tool_response',
              `get_pit_status response: ${JSON.stringify(result).substring(0, 100)}`,
              { toolName: 'get_pit_status', result }
            );

            this.session.sendToolResponse({
              functionResponses: [
                {
                  id: fc.id,
                  name: fc.name,
                  response: { result },
                },
              ],
            });
          } catch (error) {
            console.error('[GetPitStatus] Error:', error);

            // 📝 LOG: Tool response (ERROR)
            this.logEntry('received', 'tool_response',
              `get_pit_status response: ERROR - ${(error as Error).message}`,
              { toolName: 'get_pit_status', success: false, error: (error as Error).message }
            );

            this.session.sendToolResponse({
              functionResponses: [
                {
                  id: fc.id,
                  name: fc.name,
                  response: {
                    result: {
                      success: false,
                      error: (error as Error).message,
                    }
                  },
                },
              ],
            });
          }
        } else if (fc.name === "send_chat_macro") {
          // Send chat macro
          const { macroNumber } = fc.args || {};
          console.log(`[SendChatMacro] Macro: ${macroNumber}`);
          
          try {
            const result = await this.sendChatMacro(macroNumber);

            // 📝 LOG: Tool response
            this.logEntry('received', 'tool_response',
              `send_chat_macro response: macro=${macroNumber}`,
              { toolName: 'send_chat_macro', macroNumber, result }
            );

            this.session.sendToolResponse({
              functionResponses: [
                {
                  id: fc.id,
                  name: fc.name,
                  response: { result },
                },
              ],
            });
          } catch (error) {
            console.error('[SendChatMacro] Error:', error);

            // 📝 LOG: Tool response (ERROR)
            this.logEntry('received', 'tool_response',
              `send_chat_macro response: ERROR - ${(error as Error).message}`,
              { toolName: 'send_chat_macro', success: false, error: (error as Error).message }
            );

            this.session.sendToolResponse({
              functionResponses: [
                {
                  id: fc.id,
                  name: fc.name,
                  response: {
                    result: {
                      success: false,
                      error: (error as Error).message,
                    }
                  },
                },
              ],
            });
          }
        } else {
          console.warn("[TOOL] Unknown function: " + fc.name);
        }
        } catch (toolError) {
          // 🔒 GLOBAL CATCH: Log error but don't kill the connection
          console.error(`[GeminiLive] ❌ Error processing tool ${fc.name}:`, toolError);
          
          // 🔍 MONITORING: Log lock state during error
          this.logLockState('Error during tool execution');
          
          // Try to send error response to Gemini
          try {
            if (this.session) {
              this.session.sendToolResponse({
                functionResponses: [
                  {
                    id: fc.id,
                    name: fc.name,
                    response: { 
                      result: {
                        success: false,
                        error: `Tool error: ${(toolError as Error).message}`,
                      }
                    },
                  },
                ],
              });
            }
          } catch (responseError) {
            console.error(`[GeminiLive] ❌ Failed to send error response:`, responseError);
          }
        }
        }
      } finally {
        // ⏱️ MONITORING: Log tool execution duration
        const duration = Date.now() - this.toolExecutionStartTime;
        console.log(`⏱️ Tool execution completed in ${duration}ms`);
        
        // 🔒 P0 INPUT LOCK: Always unlock, even if tool execution fails
        this.setExecutionState(false); // 🔓 UNLOCK (guaranteed)
        
        // 🔍 MONITORING: Log state after unlock
        this.logLockState('Tool execution ended');
      }
    }

    // --- iRacing Command Methods ---

    /**
     * Ensure command WebSocket is connected
     */
    private ensureCommandWs(): Promise<WebSocket> {
      return new Promise((resolve, reject) => {
        if (this.commandWs && this.commandWs.readyState === WebSocket.OPEN) {
          resolve(this.commandWs);
          return;
        }

        // Connect to main server WebSocket
        const ws = new WebSocket('ws://localhost:8081');
        
        ws.onopen = () => {
          console.log('[CommandWS] ✅ Connected');
          this.commandWs = ws;
          // Server ignores messages until it marks the client "ready" after handshake.
          // Delay resolve a bit so immediate sends (e.g. REQUEST_SETUP) aren't dropped.
          setTimeout(() => resolve(ws), 250);
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            
            // Handle command responses
            if (data.type === 'pit_command_response' || 
                data.type === 'pit_status_response' || 
                data.type === 'chat_command_response') {
              const requestId = data.requestId;
              if (requestId && this.pendingCommandCallbacks.has(requestId)) {
                const callback = this.pendingCommandCallbacks.get(requestId)!;
                this.pendingCommandCallbacks.delete(requestId);
                callback.resolve(data.result);
              }
            }

            // Handle setup responses (REQUEST_SETUP -> SETUP_DATA)
            if (data.type === 'SETUP_DATA') {
              const requestId = data.requestId;
              if (requestId && this.pendingCommandCallbacks.has(requestId)) {
                const callback = this.pendingCommandCallbacks.get(requestId)!;
                this.pendingCommandCallbacks.delete(requestId);
                callback.resolve(data.payload);
              }
            }
          } catch (e) {
            console.error('[CommandWS] Parse error:', e);
          }
        };

        ws.onerror = (error) => {
          console.error('[CommandWS] Error:', error);
          reject(new Error('WebSocket connection failed'));
        };

        ws.onclose = () => {
          console.log('[CommandWS] Closed');
          this.commandWs = null;
        };

        // Timeout after 5 seconds
        setTimeout(() => {
          if (ws.readyState !== WebSocket.OPEN) {
            ws.close();
            reject(new Error('Connection timeout'));
          }
        }, 5000);
      });
    }

    /**
     * Send a pit command to iRacing
     */
    private async sendPitCommand(action: string, fuelAmount?: number, tires?: string): Promise<any> {
      const ws = await this.ensureCommandWs();
      
      // Map high-level actions to low-level commands
      const commands: Array<{ command: string; value: number }> = [];
      
      switch (action) {
        case 'clear_all':
          commands.push({ command: 'clear', value: 0 });
          break;
          
        case 'add_fuel':
          commands.push({ command: 'fuel', value: fuelAmount || 0 });
          break;
          
        case 'change_tires':
          // First clear existing tire selections
          commands.push({ command: 'clear_tires', value: 0 });
          
          // Then add the requested tires
          if (tires === 'all') {
            commands.push({ command: 'lf', value: 0 });
            commands.push({ command: 'rf', value: 0 });
            commands.push({ command: 'lr', value: 0 });
            commands.push({ command: 'rr', value: 0 });
          } else if (tires === 'fronts') {
            commands.push({ command: 'lf', value: 0 });
            commands.push({ command: 'rf', value: 0 });
          } else if (tires === 'rears') {
            commands.push({ command: 'lr', value: 0 });
            commands.push({ command: 'rr', value: 0 });
          } else if (tires === 'left') {
            commands.push({ command: 'lf', value: 0 });
            commands.push({ command: 'lr', value: 0 });
          } else if (tires === 'right') {
            commands.push({ command: 'rf', value: 0 });
            commands.push({ command: 'rr', value: 0 });
          } else if (tires === 'lf') {
            commands.push({ command: 'lf', value: 0 });
          } else if (tires === 'rf') {
            commands.push({ command: 'rf', value: 0 });
          } else if (tires === 'lr') {
            commands.push({ command: 'lr', value: 0 });
          } else if (tires === 'rr') {
            commands.push({ command: 'rr', value: 0 });
          }
          break;
          
        case 'fast_repair':
          commands.push({ command: 'fr', value: 0 });
          break;
          
        case 'windshield':
          commands.push({ command: 'ws', value: 0 });
          break;
          
        case 'clear_tires':
          commands.push({ command: 'clear_tires', value: 0 });
          break;
          
        case 'clear_fuel':
          commands.push({ command: 'clear_fuel', value: 0 });
          break;
          
        default:
          return { success: false, error: `Unknown action: ${action}` };
      }
      
      // Execute all commands
      const results: any[] = [];
      for (const cmd of commands) {
        const result = await this.sendSinglePitCommand(ws, cmd.command, cmd.value);
        results.push(result);
        
        // Small delay between commands
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      // Return combined result
      const allSuccess = results.every(r => r.success);
      return {
        success: allSuccess,
        action,
        fuelAmount,
        tires,
        commands: results,
      };
    }

    /**
     * Send a single pit command
     */
    private sendSinglePitCommand(ws: WebSocket, command: string, value: number): Promise<any> {
      return new Promise((resolve, reject) => {
        const requestId = `pit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        this.pendingCommandCallbacks.set(requestId, { resolve, reject });
        
        ws.send(JSON.stringify({
          type: 'PIT_COMMAND',
          requestId,
          command,
          value,
        }));
        
        // Timeout after 5 seconds
        setTimeout(() => {
          if (this.pendingCommandCallbacks.has(requestId)) {
            this.pendingCommandCallbacks.delete(requestId);
            resolve({ success: false, error: 'Command timeout' });
          }
        }, 5000);
      });
    }

    /**
     * Get current pit stop configuration
     */
    private async getPitStatus(): Promise<any> {
      const ws = await this.ensureCommandWs();
      
      return new Promise((resolve, reject) => {
        const requestId = `status_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        this.pendingCommandCallbacks.set(requestId, { resolve, reject });
        
        ws.send(JSON.stringify({
          type: 'GET_PIT_STATUS',
          requestId,
        }));
        
        // Timeout after 5 seconds
        setTimeout(() => {
          if (this.pendingCommandCallbacks.has(requestId)) {
            this.pendingCommandCallbacks.delete(requestId);
            resolve({ success: false, error: 'Status request timeout' });
          }
        }, 5000);
      });
    }

    /**
     * Send a chat macro in iRacing
     */
    private async sendChatMacro(macroNumber: number): Promise<any> {
      const ws = await this.ensureCommandWs();
      
      return new Promise((resolve, reject) => {
        const requestId = `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        this.pendingCommandCallbacks.set(requestId, { resolve, reject });
        
        ws.send(JSON.stringify({
          type: 'CHAT_COMMAND',
          requestId,
          macroNumber,
        }));
        
        // Timeout after 5 seconds
        setTimeout(() => {
          if (this.pendingCommandCallbacks.has(requestId)) {
            this.pendingCommandCallbacks.delete(requestId);
            resolve({ success: false, error: 'Chat command timeout' });
          }
        }, 5000);
      });
    }

    /**
     * Request latest setup data from backend via WebSocket (cached snapshot).
     * This is more reliable than relying on local state when the app just started.
     */
    private async requestLatestSetupViaWs(): Promise<any> {
      const ws = await this.ensureCommandWs();

      return new Promise((resolve, reject) => {
        const requestId = `setup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.pendingCommandCallbacks.set(requestId, { resolve, reject });

        ws.send(JSON.stringify({
          type: 'REQUEST_SETUP',
          requestId,
        }));

        // Timeout after 2 seconds (setup is cached; should be immediate)
        setTimeout(() => {
          if (this.pendingCommandCallbacks.has(requestId)) {
            this.pendingCommandCallbacks.delete(requestId);
            resolve(null);
          }
        }, 2000);
      });
    }

    // --- Audio Playback ---

    private async playAudioChunk(base64String: string) {
      if (!this.audioContext) return;

      const arrayBuffer = this.base64ToArrayBuffer(base64String);
      const float32Data = this.pcm16ToFloat32(arrayBuffer);

      // ✨ CRÍTICO: Gemini SIEMPRE envía a 24000Hz
      // Decimos explícitamente que estos datos son 24000,
      // el navegador se encarga del resampling automático
      const audioBuffer = this.audioContext.createBuffer(
        1,
        float32Data.length,
        24000,
      );
      audioBuffer.getChannelData(0).set(float32Data);

      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;

      if (this.radioBus) {
        source.connect(this.radioBus);
      } else if (this.playbackGain) {
        source.connect(this.playbackGain);
      } else {
        source.connect(this.audioContext.destination);
      }

      const currentTime = this.audioContext.currentTime;
      if (this.nextStartTime < currentTime) this.nextStartTime = currentTime;

      source.start(this.nextStartTime);
      this.nextStartTime += audioBuffer.duration;
      this.audioQueue.push(source);

      source.onended = () => {
        this.audioQueue = this.audioQueue.filter((s) => s !== source);
        if (this.audioQueue.length === 0) {
          this.onSpeakingStateChange(false);
        }
      };
    }

    private stopAudioPlayback() {
      this.audioQueue.forEach((source) => {
        try {
          source.stop();
        } catch (e) {}
      });
      this.audioQueue = [];
      this.nextStartTime = 0;
      this.onSpeakingStateChange(false);
      this.isPlaybackFading = false;
      if (this.playbackGain && this.audioContext) {
        const now = this.audioContext.currentTime;
        this.playbackGain.gain.cancelScheduledValues(now);
        this.playbackGain.gain.setValueAtTime(1, now);
      }
    }

    private stopAudioPlaybackWithFade() {
      if (!this.audioContext || !this.playbackGain || this.audioQueue.length === 0) {
        this.stopAudioPlayback();
        return;
      }

      if (this.isPlaybackFading) {
        return;
      }
      this.isPlaybackFading = true;

      const now = this.audioContext.currentTime;
      const fadeDurationSec = this.BARGE_IN_FADE_MS / 1000;
      const stopAt = now + fadeDurationSec;
      const currentGain = this.playbackGain.gain.value;

      this.playbackGain.gain.cancelScheduledValues(now);
      this.playbackGain.gain.setValueAtTime(currentGain, now);
      this.playbackGain.gain.linearRampToValueAtTime(0.0001, stopAt);

      this.audioQueue.forEach((source) => {
        try {
          source.stop(stopAt);
        } catch (e) {}
      });

      window.setTimeout(() => {
        this.audioQueue = [];
        this.nextStartTime = 0;
        this.onSpeakingStateChange(false);
        if (this.playbackGain && this.audioContext) {
          const resetAt = this.audioContext.currentTime;
          this.playbackGain.gain.cancelScheduledValues(resetAt);
          this.playbackGain.gain.setValueAtTime(1, resetAt);
        }
        this.isPlaybackFading = false;
      }, this.BARGE_IN_FADE_MS + 20);
    }

    // --- Voice Activity Detection (VAD) ---

    private startVADMonitoring() {
      if (this.vadCheckInterval !== null) {
        clearInterval(this.vadCheckInterval);
        this.vadCheckInterval = null;
      }

      // Setup analyser for voice detection (always ready)
      if (!this.vadAnalyser && this.audioContext && this.inputSource) {
        this.vadAnalyser = this.audioContext.createAnalyser();
        this.vadAnalyser.fftSize = 2048;
        this.inputSource.connect(this.vadAnalyser);
      }

      if (!this.vadAnalyser) return;
      this.voiceActiveSinceMs = null;

      // Start monitoring loop - ONLY interrupt if model is speaking
      this.vadCheckInterval = window.setInterval(() => {
        const now = Date.now();

        if (!this.isRecording) {
          this.voiceActiveSinceMs = null;
          return;
        }

        // No model speech -> no barge-in check
        if (this.audioQueue.length === 0) {
          this.voiceActiveSinceMs = null;
          return;
        }

        // Only one interruption per mic activation to avoid chopped responses
        if (this.hasBargedInThisRecording) {
          return;
        }

        // Cooldown right after PTT starts to avoid false positives/pop clicks
        if (now - this.recordingActivatedAtMs < this.BARGE_IN_COOLDOWN_MS) {
          return;
        }

        if (!this.detectVoiceActivity()) {
          this.voiceActiveSinceMs = null;
          return;
        }

        if (this.voiceActiveSinceMs === null) {
          this.voiceActiveSinceMs = now;
          return;
        }

        if (now - this.voiceActiveSinceMs < this.BARGE_IN_DEBOUNCE_MS) {
          return;
        }

        console.log('[GeminiLive] Voice detected while model speaking - interrupting (debounced + fade)');
        this.recordingActivatedAtMs = now;
        this.voiceActiveSinceMs = null;
        this.hasBargedInThisRecording = true;
        this.stopAudioPlaybackWithFade();
      }, this.VAD_CHECK_INTERVAL);

      console.log('[GeminiLive] VAD monitoring active (will interrupt only if model is speaking)');
    }

    private stopVADMonitoring() {
      if (this.vadCheckInterval !== null) {
        clearInterval(this.vadCheckInterval);
        this.vadCheckInterval = null;
      }
      this.voiceActiveSinceMs = null;

      // Disconnect analyser but keep it for reuse
      if (this.vadAnalyser && this.inputSource) {
        try {
          this.vadAnalyser.disconnect();
        } catch (e) {
          // Ignore if already disconnected
        }
      }
    }

    private detectVoiceActivity(): boolean {
      if (!this.vadAnalyser) return false;

      const bufferLength = this.vadAnalyser.fftSize;
      const dataArray = new Uint8Array(bufferLength);
      this.vadAnalyser.getByteTimeDomainData(dataArray);

      // Calculate RMS from time domain waveform
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        const centered = (dataArray[i] - 128) / 128;
        sum += centered * centered;
      }
      const rms = Math.sqrt(sum / bufferLength);

      // Convert to dB
      const db = 20 * Math.log10(Math.max(rms, 1e-7));

      // Voice detected if above threshold
      return db > this.VAD_THRESHOLD;
    }

    // --- Public Control ---

    public async startRecording() {
      console.log("🎤 Starting recording...");

      this.lastTurnTime = new Date();
      this.hasAudioThisTurn = false;
      this.recordingActivatedAtMs = Date.now();
      this.voiceActiveSinceMs = null;
      this.hasBargedInThisRecording = false;

      if (!this.isSessionReady()) {
        console.error("❌ Cannot start recording: session not ready");
        return;
      }

      if (!this.stream) {
        console.log("📍 Requesting microphone access (first time)...");
        try {
          this.stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
          console.log("✅ Microphone access granted");
        } catch (error) {
          console.error("❌ Microphone access denied:", error);
          alert("Micrófono denegado. Los mensajes proactivos funcionarán, pero no podrás hablar con Gemini.");
          return;
        }
      }

      // OPTIMIZATION: Check for both workletNode and processor
      if (!this.inputSource || (!this.processor && !this.workletNode)) {
        console.log("📍 Setting up audio input pipeline...");
        try {
          await this.setupAudioInput(); // Now async for AudioWorklet
          console.log("✅ Audio input pipeline ready");
        } catch (error) {
          console.error("❌ Failed to setup audio input:", error);
          return;
        }
      }

      if (this.audioContext?.state === "suspended") {
        console.log("📍 Resuming audio context (user gesture detected)...");
        try {
          await this.audioContext.resume();
          console.log("✅ AudioContext resumed");
        } catch (error) {
          console.error("❌ Failed to resume audio context:", error);
          return;
        }
      }

      // OPTIMIZATION: Connect appropriate audio node
      if (this.inputSource) {
        if (this.workletNode) {
          // AudioWorklet is already connected in setupAudioWorklet
          // Just tell it to start processing
          this.workletNode.port.postMessage({ type: 'start' });
          console.log("✅ AudioWorklet activated");
        } else if (this.processor) {
          this.inputSource.connect(this.processor);
        }
      }
      this.isRecording = true;
      this.onMicStateChange(true);
      
      if (this.MAX_RECORDING_DURATION_MS && this.MAX_RECORDING_DURATION_MS > 0) {
        this.recordingTimeout = setTimeout(() => {
          if (this.isRecording) {
            this.stopRecording();
          }
        }, this.MAX_RECORDING_DURATION_MS);
      }
      
      console.log("✅ Recording started");

      // 🎙️ Start VAD monitoring (only interrupts model if voice detected)
      this.startVADMonitoring();
    }

    public stopRecording() {
      // Stop VAD monitoring
      this.stopVADMonitoring();
      this.hasBargedInThisRecording = false;
      // 1. Limpiar timeout de seguridad si existe
      if (this.recordingTimeout) {
        clearTimeout(this.recordingTimeout);
        this.recordingTimeout = null;
      }
      
      console.log("🛑 Stopping recording (Toggle OFF)...");
      this.isRecording = false;

      // 2. HARD TURN COMPLETION: Enviar señal explícita de fin de turno.
      // Al ser botón Toggle + Cascos, asumimos que si el usuario corta, ha terminado de hablar.
      try {
        if (this.session && this.isConnected && this.hasAudioThisTurn) {
          try {
            this.session.sendRealtimeInput({ audioStreamEnd: true });
          } catch {}
          console.log("📤 Sending explicit turnComplete: true");
          this.sendAndLog(
            {
              turns: [{ role: "user", parts: [{ text: "" }] }], // Payload vacío
              turnComplete: true // Forzar respuesta inmediata
            },
            'turn_complete_signal',
            { reason: 'recording_stopped' }
          );
        }
      } catch (e) {
        console.warn("⚠️ Failed to send turnComplete:", e);
      }
      
      // 3. Limpieza estándar del pipeline de audio
      if (this.workletNode) {
        this.workletNode.port.postMessage({ type: 'stop' });
      }
      if (this.inputSource && this.processor) {
        try {
          this.inputSource.disconnect(this.processor);
        } catch (e) {}
      }
      
      this.onMicStateChange(false);
    }

    /**
     * 🧹 Limpia el audio pipeline sin cerrar el AudioContext.
     * Se llama cuando el WebSocket se cierra/falla para evitar seguir enviando audio.
     * OPTIMIZATION: Also handles AudioWorklet cleanup
     * 🔧 FIX: Nullify all audio graph references to force complete rebuild on reconnection
     */
    private cleanupAudioPipeline() {
      // 🔒 ONLINE: Stop keep-alive
      this.stopKeepAlive();

      // 🗣️ AUDIO GATING: reset de contador de respuestas esperadas
      this.expectedModelTurns = 0;
      
      // ⏰ PROACTIVE: Stop reconnect timer
      this.stopProactiveReconnectTimer();
      
      // 🔒 WATCHDOG: Clear tool execution timeout (CHANGE 1)
      this.clearToolWatchdog();

      // Detener grabación activa
      if (this.isRecording) {
        console.log("🛑 Stopping active recording...");
        this.isRecording = false;

        // OPTIMIZATION: Disconnect AudioWorklet if used
        if (this.inputSource && this.workletNode) {
          try {
            // Tell worklet to stop processing
            this.workletNode.port.postMessage({ type: 'stop' });
            this.inputSource.disconnect(this.workletNode);
            console.log("✅ AudioWorklet disconnected");
          } catch (e) {
            // Ya desconectado, ignorar
          }
        }

        // Desconectar ScriptProcessor si se usó como fallback
        if (this.inputSource && this.processor) {
          try {
            this.inputSource.disconnect(this.processor);
          } catch (e) {
            // Ya desconectado, ignorar
          }
        }

        // Notificar cambio de estado
        this.onMicStateChange(false);
      }

      // 🔧 CRITICAL FIX: Nullify all audio graph references
      // This forces startRecording() to rebuild the entire pipeline on next activation
      // Without this, the check `if (!this.inputSource || (!this.processor && !this.workletNode))`
      // would pass with disconnected (dead) nodes, causing silent reconnections
      if (this.inputSource) {
        try {
          this.inputSource.disconnect();
        } catch (e) {
          // Already disconnected
        }
        this.inputSource = null;
      }

      if (this.workletNode) {
        try {
          this.workletNode.port.postMessage({ type: 'stop' });
          this.workletNode.disconnect();
        } catch (e) {
          // Already disconnected
        }
        this.workletNode = null;
      }

      if (this.processor) {
        try {
          this.processor.disconnect();
        } catch (e) {
          // Already disconnected
        }
        this.processor = null;
      }

      // 🔧 OPTIONAL: Stop and nullify MediaStream to release microphone
      // This forces a fresh getUserMedia() call on next recording
      if (this.stream) {
        try {
          this.stream.getTracks().forEach(track => track.stop());
          console.log("🎙️ MediaStream tracks stopped");
        } catch (e) {
          // Already stopped
        }
        this.stream = null;
      }

      // Detener reproducción
      this.stopAudioPlayback();

      // Limpiar flags de conexión
      this.isConnected = false;
      this.isConnecting = false;
      
      // 🔒 READY GATE: Reset readiness flag (CHANGE 2)
      this.isSessionFullyReady = false;

      // Resetear estado a idle
      this.onSpeakingStateChange(false);

      console.log("✅ Audio pipeline cleaned up (all references nullified)");
    }

    /**
     * Getter público para verificar si está conectando (evitar zombie calls)
     */
    public getIsConnecting(): boolean {
      return this.isConnecting;
    }

    public disconnect() {
      console.log(
        `🔌 Disconnecting Gemini Live [Instance #${this.instanceId}] [SessionKey:`,
        this.sessionKey,
        "]",
      );

      // Limpiar audio pipeline primero
      this.cleanupAudioPipeline();
      
      // 🔧 CLEANUP: Close command WebSocket if open
      if (this.commandWs) {
        try {
          console.log("[GeminiLive] 🔌 Closing command WebSocket...");
          this.commandWs.close();
        } catch (err) {
          console.warn("[GeminiLive] ⚠️ Error closing command WebSocket:", err);
        }
        this.commandWs = null;
      }
      
      // Clear pending command callbacks
      this.pendingCommandCallbacks.clear();
      
      // Cancelar cualquier intento de reconexión pendiente
      if (this.retryTimeout) {
        clearTimeout(this.retryTimeout);
        this.retryTimeout = null;
      }
      this.retryCount = 0;
      this.lastConnectionError = null;
      
      // Limpiar cola de mensajes pendientes
      this.pendingProactiveMessages = [];

      // 🔒 CRITICAL FIX: Actually close the WebSocket session, not just null the reference
      if (this.session) {
        try {
          // Try to close the session properly
          const ws = (this.session as any)?._ws || (this.session as any)?.ws;
          if (ws && typeof ws.close === 'function') {
            console.log("[GeminiLive] 🔌 Closing WebSocket connection...");
            ws.close(1000, "Client disconnect"); // 1000 = normal closure
          }
          
          // Also try the SDK's close method if available
          if (typeof this.session.close === 'function') {
            console.log("[GeminiLive] 🔌 Calling session.close()...");
            this.session.close();
          }
        } catch (err) {
          console.warn("[GeminiLive] ⚠️ Error closing session:", err);
        }
      }
      
      // Now null the reference
      this.session = null;
      this.bridgeWs = null;
      this.isConnected = false;
      
      // 📊 Log de métricas finales
      console.log("📊 Final Connection Metrics:", this.connectionMetrics);
      this.isConnecting = false;
      this.stopKeepAlive();
      this.stopProactiveReconnectTimer();
      this.stopContextUpdates();
      
      // 📁 Detener file logging y guardar logs finales
      this.stopFileLoggingTimer();
      if (this.fileLoggingEnabled && this.sessionLogs.length > 0) {
        console.log('📁 Saving final logs before disconnect...');
        this.saveLogsToFile();
      }

      // NOTE: Do NOT close audioContext here - causes issues with React.StrictMode
      // AudioContext will be reused on reconnection
      // this.audioContext?.close();

      // Detener stream de micrófono
      this.stream?.getTracks().forEach((t) => t.stop());
      
      console.log("✅ Gemini Live disconnected");
    }

    /**
     * 🎙️ AUDIO DOWNSAMPLING: Robust resampling from 44.1/48kHz to 16kHz
     * 
     * PROBLEMA ANTERIOR: El promedio simple causaba aliasing (ruido metálico)
     * SOLUCIÓN: Implementa un filtro paso-bajo simple antes de diezmar
     * 
     * Este método usa un filtro FIR (Finite Impulse Response) simple para
     * atenuar frecuencias por encima de la frecuencia de Nyquist del output (8kHz).
     * 
     * @param buffer Audio buffer en Float32Array
     * @param inputRate Sample rate de entrada (típicamente 44100 o 48000 Hz)
     * @param outputRate Sample rate de salida (16000 Hz para Gemini)
     * @returns Buffer resampleado con anti-aliasing
     */
    private downsampleBuffer(
      buffer: Float32Array,
      inputRate: number,
      outputRate: number,
    ): Float32Array {
      // Si ya está a la tasa correcta, no hacer nada
      if (outputRate === inputRate) {
        return buffer;
      }

      const sampleRateRatio = inputRate / outputRate;
      const newLength = Math.round(buffer.length / sampleRateRatio);
      const result = new Float32Array(newLength);
      
      // 🔧 ANTI-ALIASING: Filtro paso-bajo simple (moving average)
      // Kernel size basado en el ratio de decimación
      const filterSize = Math.max(3, Math.floor(sampleRateRatio));
      const halfFilter = Math.floor(filterSize / 2);
      
      // Pre-filtrar el buffer de entrada para evitar aliasing
      const filtered = new Float32Array(buffer.length);
      for (let i = 0; i < buffer.length; i++) {
        let sum = 0;
        let count = 0;
        
        // Aplicar ventana de promedio móvil
        for (let j = -halfFilter; j <= halfFilter; j++) {
          const idx = i + j;
          if (idx >= 0 && idx < buffer.length) {
            sum += buffer[idx];
            count++;
          }
        }
        
        filtered[i] = count > 0 ? sum / count : 0;
      }
      
      // Diezmar el buffer filtrado
      for (let i = 0; i < newLength; i++) {
        const srcIndex = Math.round(i * sampleRateRatio);
        if (srcIndex < filtered.length) {
          result[i] = filtered[srcIndex];
        } else {
          result[i] = 0;
        }
      }
      
      return result;
    }

    // --- Helpers ---
    private floatTo16BitPCM(input: Float32Array): ArrayBuffer {
      const output = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      return output.buffer;
    }

    private arrayBufferToBase64(buffer: ArrayBuffer): string {
      let binary = "";
      const bytes = new Uint8Array(buffer);
      const len = bytes.byteLength;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary);
    }

    private base64ToArrayBuffer(base64: string): ArrayBuffer {
      const binaryString = atob(base64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes.buffer;
    }

    private pcm16ToFloat32(buffer: ArrayBuffer): Float32Array {
      const int16 = new Int16Array(buffer);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768.0;
      }
      return float32;
    }

    /**
     * 🤖 CONTEXT INJECTION - Inyecta contexto de competición a Gemini sin esperar respuesta
     *
     * PROPÓSITO:
     * - Mantener a Gemini actualizado sobre eventos de carrera importantes
     * - NO genera respuesta de audio inmediata
     * - Gemini puede mencionar esta info cuando sea relevante en conversación
     *
     * USO:
     * - Llamar cuando ocurre un evento relevante (overtake, gap closing, etc.)
     * - SpeechRouter decide qué eventos requieren context injection
     *
     * @param context CompetitionContext con datos de competición
     * @param eventType Tipo de evento que disparó la inyección
     */
    /**
     * � Procesa mensajes proactivos que estaban en cola esperando reconexión
     */
    private processPendingProactiveMessages(): void {
      if (this.pendingProactiveMessages.length === 0) {
        return;
      }
      
      console.log(`[GeminiLive] 📬 Processing ${this.pendingProactiveMessages.length} pending proactive messages...`);
      
      // Procesar mensajes en orden (los más antiguos primero)
      const messages = [...this.pendingProactiveMessages];
      this.pendingProactiveMessages = [];
      
      for (const msg of messages) {
        const age = Date.now() - msg.timestamp;
        
        // Descartar mensajes muy antiguos (>60 segundos)
        if (age > 60000) {
          console.log(`[GeminiLive] ⏰ Discarding old pending message (age: ${(age/1000).toFixed(1)}s)`);
          continue;
        }
        
        // Enviar el mensaje
        console.log(`[GeminiLive] 📤 Sending pending message (age: ${(age/1000).toFixed(1)}s): "${msg.text}"`);
        this.sendProactiveMessage(msg.text);
      }
    }
    
    /**
     * 🗣️ PROACTIVE MESSAGE - Envia mensaje al modelo para que lo hable
     *
     * PROPÓSITO:
     * - Forzar a Gemini a hablar sobre un evento crítico
     * - Actúa como si el ingeniero viera algo en los monitores y avisara al piloto
     * - Si la sesión no está lista, guarda el mensaje en cola para enviar al reconectar
     */
    public sendProactiveMessage(text: string): void {
      if (!this.isSessionReady()) {
        console.warn(
          "[GeminiLive] 📬 Session not ready, queueing proactive message:",
          text
        );
        
        // Agregar a cola si hay espacio
        if (this.pendingProactiveMessages.length < this.MAX_PENDING_MESSAGES) {
          this.pendingProactiveMessages.push({
            text,
            timestamp: Date.now()
          });
          console.log(`[GeminiLive] 📬 Message queued (${this.pendingProactiveMessages.length}/${this.MAX_PENDING_MESSAGES})`);
        } else {
          console.warn(`[GeminiLive] ⚠️ Pending message queue full (${this.MAX_PENDING_MESSAGES}), discarding message`);
        }
        
        return;
      }

      console.log("[GeminiLive] Sending proactive message: \"" + text + "\"");

      this.addToEventsBuffer({
        type: "PROACTIVE_MESSAGE",
        message: text,
        priority: 5,
        timestamp: Date.now(),
      });

      try {
        this.sendAndLog(
          {
            turns: [
              {
                role: "user",
                parts: [
                  {
                    text: "[MENSAJE URGENTE DEL SISTEMA]: " + text + "\n(Comunicalo al piloto de forma natural, como si lo acabaras de ver en tus monitores. Se breve.)",
                  },
                ],
              },
            ],
            turnComplete: true,
          },
          'proactive_message',
          { originalText: text }
        );

        this.lastTurnTime = new Date();

        console.log("[GeminiLive] Proactive message sent successfully");
      } catch (error) {
        console.error("[GeminiLive] Failed to send proactive message:", error);
      }
    }

    public addToEventsBuffer(event: {
      type: string;
      message: string;
      priority: number;
      timestamp: number;
    }): void {
      this.recentEventsBuffer.push(event);
      if (this.recentEventsBuffer.length > 20) {
        this.recentEventsBuffer.shift();
      }
    }

    /**
     * 🤖 CONTEXT UPDATE - Envía contexto periódico a Gemini
     * El modelo recibe información continua de la carrera.
     * turnComplete: false = solo contexto, no forzar respuesta
     *
     * 🔧 FIX: Reducido a updates menos frecuentes para no saturar la conexión
     * - En carrera: cada 30s (era 10s)
     * - En práctica/qualy: cada 60s (era 30s)
     *
     * 🛡️ P1-FIX5: Aumentado throttle para prevenir colisiones con race events
     * - En carrera: 60s (era 30s) - reduce probabilidad de colisión con eventos
     * - En práctica/qualy: 120s (era 60s) - menos crítico, menos frecuencia
     */
    private lastTelemetryUpdateTime = 0;
    private readonly CONTEXT_UPDATE_INTERVAL_RACE = 15000; // 15 segundos en carrera
    private readonly CONTEXT_UPDATE_INTERVAL_OTHER = 30000; // 30 segundos en práctica/qualy
    
    // 🔧 FIX: Track if we're waiting for a response to avoid message pile-up
    private isWaitingForResponse = false;
    private lastResponseTime = 0;

    /**
     * 📊 CONTEXT UPDATE - Envía telemetría pasiva a Gemini
     * 
     * 🔧 CRÍTICO: NO usa turnComplete para evitar bloquear al modelo
     * El modelo recibe información continua de la carrera pero decide cuándo hablar.
     * 
     * CAMBIO IMPORTANTE:
     * - ELIMINADO turnComplete: false que bloqueaba al modelo esperando más texto
     * - Ahora el modelo puede responder proactivamente si detecta algo importante
     * - Para eventos urgentes, usar sendCriticalAlert() o handleRaceEvent()
     * 
     * @param telemetry Datos de telemetría actualizados
     */
    public sendContextUpdate(telemetry: TelemetryData): void {
      // 🔒 SANITY CHECK: Validate timestamp freshness (prevent phantom data)
      // If telemetry is older than 10 seconds, it's stale - ignore it
      const currentTime = Date.now();
      const telemetryAge = currentTime - telemetry.timestamp;
      const MAX_TELEMETRY_AGE_MS = 10 * 1000; // 10 seconds
      
      if (telemetryAge > MAX_TELEMETRY_AGE_MS) {
        console.warn(
          `[GeminiLive] ⚠️ STALE TELEMETRY IGNORED: ${(telemetryAge / 1000).toFixed(1)}s old (max: ${MAX_TELEMETRY_AGE_MS / 1000}s)`
        );
        
        // Send explicit "disconnected" context to Gemini if we haven't already
        if (this.isSessionReady() && this.currentTelemetry !== null) {
          console.log('[GeminiLive] 📡 Sending "simulator disconnected" context to Gemini');
          try {
            this.sendAndLog(
              {
                turns: [
                  {
                    role: "user",
                    parts: [{ text: "[CONTEXTO]\nEstado: Simulador desconectado / En espera\nNo hay datos activos de telemetría." }],
                  },
                ],
              },
              'simulator_disconnected',
              { telemetryAge: Math.floor(telemetryAge / 1000) }
            );
          } catch (error) {
            console.error("[GeminiLive] ❌ Failed to send disconnected context:", error);
          }
          
          // Clear current telemetry to avoid repeated messages
          this.currentTelemetry = null;
        }
        
        return; // Don't process stale data
      }
      
      // 🔒 P0 INPUT LOCK: Cache telemetry but don't send during tool execution
      if (this.inputLock) {
        this.currentTelemetry = telemetry; // Always cache latest
        
        // 📦 P2: Queue critical events for later processing
        const isCritical = this.isCriticalTelemetryEvent(telemetry);
        if (isCritical) {
          this.pendingEventsQueue.push({
            type: 'telemetry',
            payload: telemetry,
            timestamp: Date.now()
          });
          console.log('📦 Critical telemetry queued during tool execution:', isCritical);
        }
        return;
      }
      
      if (!this.isSessionReady()) return;
      
      // 🔧 FIX: No enviar contexto si estamos esperando respuesta de Gemini
      // Esto evita que los mensajes se acumulen y saturen la conexión
      if (this.isWaitingForResponse) {
        const waitTime = Date.now() - this.lastResponseTime;
        if (waitTime < 30000) { // Esperar máximo 30s
          return; // Skip this update
        }
        // Si llevamos >30s esperando, resetear el flag
        this.isWaitingForResponse = false;
      }

      const now = Date.now();
      const sessionType = telemetry.session?.type?.toLowerCase() || '';
      const interval = sessionType.includes('race')
        ? this.CONTEXT_UPDATE_INTERVAL_RACE
        : this.CONTEXT_UPDATE_INTERVAL_OTHER;
      
      if (now - this.lastTelemetryUpdateTime < interval) {
        return; // Throttled
      }

      this.lastTelemetryUpdateTime = now;

      // Construir contexto compacto (JSON minificado, no tablas ASCII)
      const context = this.buildCompactContext(telemetry);
      
      // 🔧 FIX: Log menos verbose para no saturar la consola
      // console.log("[GeminiLive] 📊 Sending context update...");

      try {
        // 📝 Log FULL context BEFORE sending (for debugging)
        this.logEntry('sent', 'context_sent', context, {
          sessionType: this.currentTelemetry?.session?.type,
          position: this.currentTelemetry?.position?.overall,
          contentLength: context.length,
        });

        // 🔧 CRÍTICO: NO usar turnComplete
        // Dejar que el modelo decida si hay algo importante que comentar
        // Si necesitas forzar respuesta, usa sendCriticalAlert() o handleRaceEvent()
        this.sendAndLog(
          {
            turns: [
              {
                role: "user",
                parts: [{ text: `[CONTEXTO]\n${context}\nNOTA: NO respondas.` }],
              },
            ],
            // 🔧 ELIMINADO: turnComplete: false
            // Esto bloqueaba al modelo esperando más input
          },
          'context_update',
          {
            sessionType: telemetry.session?.type,
            position: telemetry.position?.overall,
            lapsCompleted: telemetry.timing?.lapsCompleted
          }
        );
      } catch (error) {
        console.error("[GeminiLive] ❌ Failed to send context:", error);
      }
    }

    /**
     * 🚨 CRITICAL ALERT - Envía alerta que REQUIERE respuesta de Gemini
     * turnComplete: true = Gemini DEBE responder
     */
    public sendCriticalAlert(alertType: string, data: Record<string, any>): void {
      if (!this.isSessionReady()) {
        console.warn("[GeminiLive] ⚠️ Cannot send alert: session not ready");
        return;
      }

      const now = Date.now();
      const lastSent = this.lastAlertSent[alertType] || 0;
      if (now - lastSent < this.REPEAT_COOLDOWN_MS) {
        return;
      }

      const alertMessage = this.formatAlertMessage(alertType, data);
      console.log(`[GeminiLive] 🚨 CRITICAL ALERT: ${alertType}`);

      try {
        this.sendAndLog(
          {
            turns: [
              {
                role: "user",
                parts: [{ text: alertMessage }],
              },
            ],
            turnComplete: true, // FORZAR respuesta de Gemini
          },
          'critical_alert',
          { alertType, data }
        );

        this.isWaitingForResponse = true; // 🔧 FIX: Track pending response
        this.lastAlertSent[alertType] = now;
      } catch (error) {
        this.logEntry('error', 'critical_alert', `Failed: ${error}`, { alertType });
        console.error("[GeminiLive] ❌ Failed to send alert:", error);
      }
    }

    /**
     * 🧪 TEST: Inyecta evento de prueba para verificar proactividad
     * Usar desde la consola del navegador:
     *   window.testGeminiEvent('green_flag')
     *   window.testGeminiEvent('position_gain')
     *   window.testGeminiEvent('best_lap')
     *   window.testGeminiEvent('yellow_flag')
     *   window.testGeminiEvent('fuel_warning')
     */
    public injectTestEvent(eventType: string): void {
      if (!this.isSessionReady()) {
        console.error("[GeminiLive] ❌ Cannot inject test event: session not ready");
        return;
      }

      let testMessage: string;
      
      switch (eventType) {
        case 'green_flag':
          testMessage = `[EVENTO: BANDERA VERDE]
  La carrera acaba de empezar. Luz verde, semáforos apagados.

  [INSTRUCCIÓN]: ¡Anuncia la bandera verde con energía! Di "Verde verde verde" o algo similar. Motiva al piloto. Recuérdale tener cuidado en la primera curva. Máximo 2 frases.`;
          break;

        case 'position_gain':
          testMessage = `[EVENTO: CAMBIO DE POSICIÓN]
  Has GANADO 2 posiciones. Ahora vas P5.
  Gap al coche de delante: 1.8s | Gap al de detrás: 2.3s

  [INSTRUCCIÓN]: ¡Felicita al piloto por las posiciones ganadas! Menciona el gap al siguiente objetivo. Máximo 2 frases, estilo radio F1.`;
          break;

        case 'position_loss':
          testMessage = `[EVENTO: CAMBIO DE POSICIÓN]
  Has PERDIDO 1 posición. Ahora vas P8.
  Gap al coche de delante: 3.2s | Gap al de detrás: 0.6s

  [INSTRUCCIÓN]: Informa al piloto de la posición perdida sin dramatizar. Motívale a recuperarla. Menciona que tiene un coche cerca detrás. 1-2 frases.`;
          break;

        case 'best_lap':
          testMessage = `[EVENTO: MEJOR VUELTA PERSONAL]
  Vuelta 12: 1:32.456
  Mejora: 0.387s más rápido que tu anterior mejor vuelta.
  Fuel usado esta vuelta: 2.41L

  [INSTRUCCIÓN]: ¡Felicita al piloto por la mejor vuelta personal! Menciona el tiempo y la mejora. Estilo radio F1 con energía positiva. Breve.`;
          break;

        case 'yellow_flag':
          testMessage = `[EVENTO: BANDERA AMARILLA]
  Precaución en pista. Bandera amarilla desplegada.

  [INSTRUCCIÓN]: Alerta al piloto de la amarilla con tono urgente. Que levante el pie y tenga cuidado. 1-2 frases.`;
          break;

        case 'fuel_warning':
          testMessage = `[EVENTO: COMBUSTIBLE BAJO]
  Quedan aproximadamente 2.3 vueltas de fuel.
  Nivel actual: 4.8L
  Consumo promedio: 2.1L/vuelta

  [INSTRUCCIÓN]: Avisa al piloto que el fuel está bajo. Recomienda planificar la parada pronto. Tono de urgencia pero sin pánico. 1-2 frases.`;
          break;

        case 'last_lap':
          testMessage = `[EVENTO: BANDERA BLANCA - ÚLTIMA VUELTA]
  Esta es la última vuelta de la carrera.
  Posición actual: P4 | Gap delante: 0.8s | Gap detrás: 1.2s

  [INSTRUCCIÓN]: ¡Anuncia la última vuelta con energía! Motiva al piloto a darlo todo. Menciona que puede atacar al de delante. Estilo radio F1.`;
          break;

        case 'checkered':
          testMessage = `[EVENTO: BANDERA A CUADROS]
  ¡Carrera terminada! Posición final: P4

  [INSTRUCCIÓN]: Felicita efusivamente al piloto por terminar la carrera en un buen puesto. Celebra el P4. Estilo radio F1 post-carrera.`;
          break;

        case 'incident':
          testMessage = `[EVENTO: INCIDENTES]
  +2x incidentes detectados en la última curva.
  Total acumulado: 6x de 17x permitidos.

  [INSTRUCCIÓN]: Avisa del incidente sin dramatizar. Recuérdale el límite. 1-2 frases.`;
          break;

        default:
          console.error(`[GeminiLive] ❌ Unknown test event: ${eventType}`);
          console.log("Available test events: green_flag, position_gain, position_loss, best_lap, yellow_flag, fuel_warning, last_lap, checkered, incident");
          return;
      }

      console.log(`[GeminiLive] 🧪 INJECTING TEST EVENT: ${eventType}`);

      try {
        this.sendAndLog(
          {
            turns: [
              {
                role: "user",
                parts: [{ text: testMessage }],
              },
            ],
            turnComplete: true, // ⚡ FORZAR RESPUESTA
          },
          'test_event',
          { eventType }
        );

        console.log(`[GeminiLive] ✅ Test event injected successfully`);
      } catch (error) {
        this.logEntry('error', 'test_event', `Failed: ${error}`, { eventType });
        console.error("[GeminiLive] ❌ Failed to inject test event:", error);
      }
    }

    /**
     * Construye contexto compacto para updates periódicos
     */
    private buildCompactContext(t: TelemetryData): string {
      const sanitized = sanitizeTelemetry(t);
      const pacing = this.isPacingActive(t);
      const myPosition = sanitized.position.overall;
      const sessionType = sanitized.session.type.toLowerCase();
      const isRace = sessionType.includes('race') || sessionType.includes('carrera');
      
      // 🏁 MULTICLASS: Get class info
      const myClassName = getMyClassName(t);
      const classStandings = getClassStandings(t);
      const myStanding = getMyStanding(t);
      const myClassPosition = myStanding?.classPosition || 0;
      const isMulticlass = myClassName !== null && classStandings.length > 0;
      
      if (pacing === 'YES') {
        return `[CONTEXTO - ${sanitized.session.simulator}]\nSesión: ${sanitized.session.type}\nPACING:YES | ${formatPosition(sanitized)} | ${formatLap(sanitized)}\nEn formación/warmup - sin datos de ritmo`;
      }

      const lines: string[] = [];
      lines.push(`[CONTEXTO - ${sanitized.session.simulator}]`);
      lines.push(`Sesión: ${sanitized.session.type}`);
      lines.push(`PACING:${pacing}`);
      lines.push('');
      
      lines.push(`Circuito: ${sanitized.session.trackName}`);
      lines.push(`Coche: ${sanitized.session.carName}`);
      
      // 🏁 MULTICLASS: Show class info if available
      if (isMulticlass) {
        lines.push(`Clase: ${myClassName}`);
        lines.push(`Posición: P${myPosition}/${sanitized.position.totalCars} | Clase: P${myClassPosition}/${classStandings.length}`);
        lines.push(`Vuelta: ${formatLap(sanitized)}`);
      } else {
        lines.push(`Posición: ${formatPosition(sanitized)} | ${formatLap(sanitized)}`);
      }

      // ⏱️ CONTEXTO BÁSICO (faltaba): vueltas totales / completadas y/o tiempo restante
      if (isRace) {
        const lapsCompleted = (typeof t.timing?.lapsCompleted === 'number' && t.timing.lapsCompleted >= 0) ? t.timing.lapsCompleted : null;
        const lapsTotal = (typeof t.session?.lapsTotal === 'number' && t.session.lapsTotal > 0) ? t.session.lapsTotal : null;
        const lapsRemaining = (typeof t.session?.lapsRemaining === 'number' && t.session.lapsRemaining > 0) ? t.session.lapsRemaining : null;
        const timeRemaining = (typeof t.session?.timeRemaining === 'number' && t.session.timeRemaining > 0) ? t.session.timeRemaining : null;
        const estLapTime = (typeof t.session?.estLapTime === 'number' && t.session.estLapTime > 0) ? t.session.estLapTime : null;

        const fmtTimeRemaining = (secs: number) => {
          const m = Math.floor(secs / 60);
          const s = Math.floor(secs % 60);
          return `${m}m${String(s).padStart(2, '0')}s`;
        };

        const lapsFromTime = (timeRemaining !== null && estLapTime !== null)
          ? Math.max(0, Math.ceil(timeRemaining / estLapTime))
          : null;

        if (lapsTotal !== null && lapsCompleted !== null) {
          lines.push(`Progreso: ${lapsCompleted}/${lapsTotal} vueltas`);
        } else if (lapsRemaining !== null) {
          lines.push(`Restan: ${lapsRemaining} vueltas`);
        } else if (timeRemaining !== null) {
          lines.push(`Restan: ${fmtTimeRemaining(timeRemaining)}${lapsFromTime !== null ? ` (~${lapsFromTime}v)` : ''}`);
        }
      }
      lines.push('');
      
      if (sanitized.timing.lastLapTime !== null) {
        lines.push(`SESSION LAST LAP: ${formatTimeForGemini(sanitized.timing.lastLapTime)}`);
      }
      
      // 🏁 Explicitly show player's best lap to avoid confusion
      const myBest = sanitized.timing.bestLapTime;
      lines.push(`TU MEJOR VUELTA: ${myBest ? formatTimeForGemini(myBest) : 'Sin tiempo'}`);

      const fuelAmount = formatFuelAmount(sanitized);
      const fuelPercent = formatFuelPercent(sanitized);
      const usedLastLap = t.fuel?.usedLastLap;
      const usedLastLapStr = (typeof usedLastLap === 'number' && usedLastLap > 0)
        ? `${usedLastLap.toFixed(2)}L`
        : 'N/A';
      lines.push(`Fuel: ${fuelAmount} ${fuelPercent}`);
      lines.push(`Consumo última vuelta: ${usedLastLapStr}`);

      if (isRace) {
        const gapAhead = sanitized.gaps.ahead;
        const gapBehind = sanitized.gaps.behind;
        const gapLeader = sanitized.gaps.toLeader;
        const fmt = (v: number | null) => v === null ? 'N/A' : `${v.toFixed(1)}s`;
        const changed = (prev: number | null, next: number | null, threshold: number) => {
          if (next === null) return false;
          if (prev === null) return true;
          return Math.abs(next - prev) >= threshold;
        };
        const closeBattle = (v: number | null) => v !== null && v > 0 && v < 1.0;
        const includeGaps =
          closeBattle(gapAhead) ||
          closeBattle(gapBehind) ||
          changed(this.lastContextGaps.ahead, gapAhead, 0.3) ||
          changed(this.lastContextGaps.behind, gapBehind, 0.3) ||
          changed(this.lastContextGaps.toLeader, gapLeader, 0.5);

        if (includeGaps) {
          lines.push(`GAP: delante ${fmt(gapAhead)} | detrás ${fmt(gapBehind)} | líder ${fmt(gapLeader)}`);
          this.lastContextGaps = { ahead: gapAhead, behind: gapBehind, toLeader: gapLeader };
        }
      }
      
      if (t.pit?.inPitLane) {
        lines.push('');
        lines.push('Estado: EN PIT LANE');
      }
      
      if (t.incidents?.count > 0) {
        lines.push('');
        lines.push(`Incidentes: ${t.incidents.count}x`);
      }
      
      return lines.join('\n');
    }


    /**
     * Formatea mensaje de alerta crítica
     */
    private formatAlertMessage(alertType: string, data: Record<string, any>): string {
      switch (alertType) {
        case 'fuel_critical': {
          const liters = typeof data.fuelLevel === 'number' ? `${data.fuelLevel.toFixed(1)}L` : null;
          return `[ALERTA CRITICA] ⛽ COMBUSTIBLE CRITICO${liters ? ` (${liters})` : ''}. ${data.message || 'Necesitas entrar a boxes AHORA o te quedarás en pista.'}`;
        }
        
        case 'fuel_low': {
          const liters = typeof data.fuelLevel === 'number' ? `${data.fuelLevel.toFixed(1)}L` : null;
          return `[ALERTA] ⛽ Combustible bajo${liters ? ` (${liters})` : ''}. ${data.message || 'Considera tu estrategia de parada.'}`;
        }
        
        case 'rain_incoming':
          return `[ALERTA] 🌧️ LLUVIA DETECTADA: ${data.message || 'Condiciones cambiando. Evalúa cambio a neumáticos de lluvia.'}`;
        
        case 'track_temp_change':
          return `[ALERTA] 🌡️ Temperatura de pista cambiando: ${data.oldTemp}°C → ${data.newTemp}°C. Puede afectar grip.`;
        
        case 'damage_severe':
          return `[ALERTA] 💥 DAÑO SEVERO: ${data.message || 'El coche tiene daño significativo. Evalúa si puedes continuar.'}`;
        
        case 'position_gained':
          return `[INFO] 🏁 Subiste a P${data.position}! ${data.message || ''}`;
        
        case 'position_lost':
          return `[INFO] 📉 Bajaste a P${data.position}. ${data.message || ''}`;
          
        default:
          return `[ALERTA] ${alertType}: ${JSON.stringify(data)}`;
      }
    }

    public injectCompetitionContext(
      context: CompetitionContext,
      eventType: string,
    ): void {
      if (!this.isSessionReady()) {
        console.warn("[GeminiLive] ⚠️ Cannot inject context: session not ready");
        return;
      }

      // 🚨 CRITICAL FIX: Throttle context injection to prevent saturation
      // Only inject context every 3 seconds MAX, regardless of event frequency
      const now = Date.now();
      const timeSinceLastInjection = now - (this.lastContextInjectionTime || 0);
      
      if (timeSinceLastInjection < 3000) {
        console.log(
          "[GeminiLive] ⏸️  Context injection THROTTLED for " + eventType + " (" + Math.round((3000 - timeSinceLastInjection) / 1000) + "s remaining)",
        );
        return;
      }
      
      this.lastContextInjectionTime = now;

      console.log(
        "[GeminiLive] 💉 INJECTING competition context for event: " + eventType,
      );

      // Formatear contexto como mensaje legible para Gemini
      const contextMessage = this.formatContextMessage(context, eventType);
      console.log("[GeminiLive] 📝 Context preview:", contextMessage.substring(0, 200) + "...");

      try {
        // Enviar como "client content" sin esperar respuesta
        // turnComplete: false = no generar respuesta de audio
        this.sendAndLog(
          {
            turns: [
              {
                role: "user",
                parts: [{ text: `[CONTEXTO]\n${contextMessage}\nNOTA: No respondas.` }],
              },
            ],
          },
          'context_injection',
          { eventType, preview: contextMessage.substring(0, 150) }
        );

        console.log("[GeminiLive] ✅ Context injected successfully");
      } catch (error) {
        console.error("[GeminiLive] ❌ Failed to inject context:", error);
      }
    }

    /**
     * Formatea CompetitionContext como mensaje legible para Gemini
     * ENRIQUECIDO con vecinos, daño y situación de carrera estilo CrewChief
     */
    private formatContextMessage(
      context: CompetitionContext,
      eventType: string,
    ): string {
      const lines: string[] = [];

      // Timing info (siempre relevante)
      if (context.timing.lastLapTime > 0) {
        const lapTime = formatTimeForGemini(context.timing.lastLapTime);
        const delta = context.timing.deltaToSessionBest;
        const deltaStr =
          delta > 0
            ? "+" + (delta / 1000).toFixed(2) + "s"
            : delta < 0
              ? (delta / 1000).toFixed(2) + "s"
              : "session best";
        lines.push("Ultima vuelta: " + lapTime + " (" + deltaStr + " vs mejor)");
      }

      // Race position
      if (context.race.position > 0) {
        lines.push("Posicion: P" + context.race.position);
      }

      // 🎯 VECINOS: Oponente delante con nombre y gap
      if (context.race.opponentAhead) {
        const opp = context.race.opponentAhead;
        lines.push(`Delante: ${opp.name} (${opp.gapFormatted})`);
      } else if (context.race.gapAhead > 0 && context.race.gapAhead < 10) {
        lines.push("Gap delante: " + context.race.gapAhead.toFixed(1) + "s");
      }

      // 🎯 VECINOS: Oponente detrás con nombre y gap
      if (context.race.opponentBehind) {
        const opp = context.race.opponentBehind;
        lines.push(`Detras: ${opp.name} (${opp.gapFormatted})`);
      } else if (context.race.gapBehind > 0 && context.race.gapBehind < 10) {
        lines.push("Gap detras: " + context.race.gapBehind.toFixed(1) + "s");
      }

      // 🎯 DAÑO: Estado de daño estructurado
      if (context.damage && context.damage.severity !== 'none') {
        lines.push(`DANO: ${context.damage.message}`);
      }

      // 🎯 SITUACIÓN: Presión/Held-up con gaps críticos
      if (context.situation.isBeingPressured) {
        lines.push(`PRESION: Gap critico ${context.situation.pressureGap?.toFixed(2)}s detras`);
      }
      if (context.situation.isHeldUp) {
        lines.push(`ATASCADO: Gap critico ${context.situation.heldUpGap?.toFixed(2)}s delante`);
      }

      // Flags criticas
      if (context.session.flags.yellow) {
        lines.push("BANDERA AMARILLA");
      }
      if (context.session.flags.blue) {
        lines.push("BANDERA AZUL - Dejar pasar");
      }

      // Strategy info
      if (
        context.strategy.fuelLapsRemaining > 0 &&
        context.strategy.fuelLapsRemaining < 5
      ) {
        lines.push(
          "Combustible: " + context.strategy.fuelLapsRemaining + " vueltas restantes",
        );
      }

      // Event-specific context
      switch (eventType) {
        case "BEING_PRESSURED":
          lines.push("Presion por detras - manten la concentracion");
          break;
        case "HELD_UP":
          lines.push("Atascado - buscar oportunidad de adelantar");
          break;
        case "GAP_TREND_WARNING":
          lines.push("Gap cerrandose - revisar pace");
          break;
        case "OVERTAKE":
          lines.push("Adelantamiento completado");
          break;
        case "BEING_OVERTAKEN":
          lines.push("Han completado adelantamiento");
          break;
        case "DAMAGE_WARNING":
          lines.push("Revisar dano del vehiculo");
          break;
        case "CONSISTENCY_UPDATE":
          lines.push("Analisis de consistencia actualizado");
          break;
      }

      return lines.join("\n");
    }

    // DEPRECATED: Use createSessionContext() instead
    // This method returned old snapshot with fuel data
    public getTelemetrySnapshot(): any {
      console.warn('[GeminiLive] getTelemetrySnapshot() is deprecated, use get_session_context tool instead');
      return { deprecated: true };
    }

    // === NEW PROACTIVITY SYSTEM ===
    
    /**
     * 🏎️ RACE SNAPSHOT - Envía contexto completo para que Gemini decida qué decir
     * 
     * DIFERENCIA CLAVE con sendProactiveMessage:
     * - Antes: "Di esto: Vuelta 8: 1:23.456"
     * - Ahora: "Aquí está todo el contexto. Analiza y decide si decir algo."
     * 
     * @param snapshot RaceSnapshot completo con attention window
     */
    public sendRaceSnapshot(snapshot: import('../engine/types/race-snapshot.types').RaceSnapshot): void {
      if (!this.isSessionReady()) {
        console.warn("[GeminiLive] 📬 Session not ready, race snapshot discarded");
        return;
      }

      const now = Date.now();
      const isRepeatType = this.lastSnapshotType === snapshot.attention.type;
      const withinCooldown = (now - this.lastSnapshotTime) < this.REPEAT_COOLDOWN_MS;
      if (isRepeatType && withinCooldown && (snapshot.attention.urgency === 'low' || snapshot.attention.urgency === 'medium')) {
        return;
      }

      const urgencyInstruction = this.getUrgencyInstruction(snapshot.attention.urgency);
      
      // Formatear snapshot de forma compacta pero legible
      const compactSnapshot = this.formatSnapshotForGemini(snapshot);
      
      const prompt = `[RACE_UPDATE: ${snapshot.attention.type}]
  ${urgencyInstruction}

  CONTEXTO ACTUAL:
  ${compactSnapshot}

  INSTRUCCIONES:
  1. Analiza la situación completa
  2. Decide si hay algo relevante que comunicar al piloto
  3. Si decides hablar: máximo 8 palabras, estilo radio F1
  4. Si no hay nada relevante: responde exactamente "[SILENCE]"

  RECUERDA:
  - No repitas información que ya dijiste
  - Los gaps menores a 0.3s de cambio no son noticia
  - En batalla: solo reporta si hay cambio significativo
  - El piloto necesita concentrarse, no spam`;

      try {
        this.sendAndLog(
          {
            turns: [{ role: "user", parts: [{ text: prompt }] }],
            turnComplete: true,
          },
          'race_snapshot',
          {
            attentionType: snapshot.attention.type,
            urgency: snapshot.attention.urgency,
            reason: snapshot.attention.reason
          }
        );
        this.lastSnapshotType = snapshot.attention.type;
        this.lastSnapshotTime = now;
        
        // Añadir al buffer de eventos recientes
        this.addToEventsBuffer({
          type: `RACE_SNAPSHOT_${snapshot.attention.type}`,
          message: snapshot.attention.reason,
          priority: this.urgencyToPriority(snapshot.attention.urgency),
          timestamp: Date.now(),
        });
        
        console.log(`[GeminiLive] 🏎️ Race snapshot sent: ${snapshot.attention.type} (${snapshot.attention.urgency})`);
      } catch (error) {
        console.error("[GeminiLive] ❌ Failed to send race snapshot:", error);
      }
    }

    private getUrgencyInstruction(urgency: string): string {
      switch (urgency) {
        case 'CRITICAL': return '🚨 URGENTE: Situación crítica, comunica inmediatamente.';
        case 'HIGH': return '⚠️ IMPORTANTE: Evalúa si requiere comunicación.';
        case 'MEDIUM': return 'ℹ️ INFO: Comunica solo si hay insights relevantes.';
        case 'LOW': return '📊 RUTINA: Solo habla si detectas algo que el piloto debería saber.';
        default: return '';
      }
    }

    private urgencyToPriority(urgency: string): number {
      switch (urgency) {
        case 'CRITICAL': return 10;
        case 'HIGH': return 7;
        case 'MEDIUM': return 5;
        case 'LOW': return 3;
        default: return 5;
      }
    }

    private formatSnapshotForGemini(snapshot: import('../engine/types/race-snapshot.types').RaceSnapshot): string {
      const lines: string[] = [];
      
      // Timing
      const formatTime = (ms: number): string => {
        if (!ms || ms <= 0) return "N/A";
        return (ms / 1000).toFixed(3);
      };
      
      lines.push(`== TIMING ==`);
      lines.push(`Vuelta: ${snapshot.timing.currentLap}${snapshot.timing.totalLaps ? `/${snapshot.timing.totalLaps}` : ''}`);
      lines.push(`Última vuelta: ${formatTime(snapshot.timing.lastLapMs)} (${snapshot.timing.lapValidity})`);
      
      if (snapshot.timing.deltaToPersonalBestMs !== 0) {
        const sign = snapshot.timing.deltaToPersonalBestMs > 0 ? '+' : '';
        lines.push(`Delta vs mejor: ${sign}${(snapshot.timing.deltaToPersonalBestMs / 1000).toFixed(3)}s`);
      }
      
      // Sectores con deltas
      const sectors = snapshot.timing.sectors;
      if (sectors.s1Ms || sectors.s2Ms || sectors.s3Ms) {
        const s1 = sectors.s1Ms ? `S1: ${formatTime(sectors.s1Ms)}${sectors.s1DeltaMs ? ` (${sectors.s1DeltaMs > 0 ? '+' : ''}${(sectors.s1DeltaMs/1000).toFixed(3)})` : ''}` : '';
        const s2 = sectors.s2Ms ? `S2: ${formatTime(sectors.s2Ms)}${sectors.s2DeltaMs ? ` (${sectors.s2DeltaMs > 0 ? '+' : ''}${(sectors.s2DeltaMs/1000).toFixed(3)})` : ''}` : '';
        const s3 = sectors.s3Ms ? `S3: ${formatTime(sectors.s3Ms)}${sectors.s3DeltaMs ? ` (${sectors.s3DeltaMs > 0 ? '+' : ''}${(sectors.s3DeltaMs/1000).toFixed(3)})` : ''}` : '';
        lines.push(`Sectores: ${[s1, s2, s3].filter(Boolean).join(' | ')}`);
      }
      
      // Position & Rivals
      lines.push(`\n== POSICIÓN ==`);
      lines.push(`P${snapshot.position.current}/${snapshot.position.total}${snapshot.position.classPosition ? ` (clase: P${snapshot.position.classPosition})` : ''}`);
      
      if (snapshot.position.ahead) {
        const a = snapshot.position.ahead;
        const trendSymbol = a.gapTrend === 'CLOSING' ? '↓' : a.gapTrend === 'OPENING' ? '↑' : '→';
        const iRatingText = a.iRating ? ` [iR:${a.iRating}]` : '';
        const gapValue = a.gapMs ?? (a.gap * 1000);
        lines.push(`Delante: ${a.name} a ${(gapValue/1000).toFixed(1)}s ${trendSymbol}${iRatingText}`);
      }
      
      if (snapshot.position.behind) {
        const b = snapshot.position.behind;
        const trendSymbol = b.gapTrend === 'CLOSING' ? '↓' : b.gapTrend === 'OPENING' ? '↑' : '→';
        const iRatingText = b.iRating ? ` [iR:${b.iRating}]` : '';
        const gapValue = b.gapMs ?? (b.gap * 1000);
        lines.push(`Detrás: ${b.name} a ${(gapValue/1000).toFixed(1)}s ${trendSymbol}${iRatingText}`);
      }
      
      // Vehicle state (solo si hay algo relevante)
      if (snapshot.vehicle.hasDamage || (snapshot.vehicle.fuelLapsRemaining && snapshot.vehicle.fuelLapsRemaining < 5)) {
        lines.push(`\n== VEHÍCULO ==`);
        if (snapshot.vehicle.hasDamage) {
          lines.push(`Daño: ${snapshot.vehicle.damageLevel}`);
        }
        if (snapshot.vehicle.fuelLapsRemaining) {
          lines.push(`Fuel: ${snapshot.vehicle.fuelLapsRemaining.toFixed(1)} vueltas`);
        }
      }
      
      // Recent laps (para ver tendencia)
      if (snapshot.recentLaps.length > 1) {
        lines.push(`\n== ÚLTIMAS VUELTAS ==`);
        snapshot.recentLaps.slice(-3).forEach((lap: import('../engine/types/race-snapshot.types').SnapshotLap) => {
          const validText = lap.wasValid === false ? ' (INV)' : '';
          const lapTimeValue = lap.lapTimeMs ?? lap.lapTime;
          lines.push(`V${lap.lapNumber}: ${formatTime(lapTimeValue)}${validText}`);
        });
      }
      
      // Session flags
      if (snapshot.session.flags !== 'NONE' && snapshot.session.flags !== 'GREEN') {
        lines.push(`\n⚠️ FLAG: ${snapshot.session.flags}`);
      }
      
      return lines.join('\n');
    }

    public getVehicleSetup(): any {
      console.log('[getVehicleSetup] Checking setup data:', {
        hasTelemetry: !!this.currentTelemetry,
        hasSetup: !!this.currentSetup,
        setupKeys: this.currentSetup?.carSetup
          ? Object.keys(this.currentSetup.carSetup)
          : (this.currentSetup?.payload?.carSetup ? Object.keys(this.currentSetup.payload.carSetup) : [])
      });

      if (!this.currentTelemetry) {
        return { 
          car: { name: "Unknown" },
          track: { name: "Unknown" },
          session: { type: "Unknown", simulator: "Unknown" },
          note: "Waiting for session to start"
        };
      }

      const telemetry = this.currentTelemetry;
      
      // Setup envelope comes from backend (iRacing or LMU)
      const setupEnvelope = this.currentSetup;
      const setupData =
        setupEnvelope?.carSetup ??
        setupEnvelope?.payload?.carSetup ??
        setupEnvelope?.setup ??
        null;

      const baseData = {
        car: {
          name: telemetry.session?.carName || "Unknown",
        },
        track: {
          name: telemetry.session?.trackName || "Unknown",
          temperature: telemetry.track?.tempCelsius || 0,
          airTemp: telemetry.track?.airTempCelsius || 0,
        },
        session: {
          type: telemetry.session?.type || "Unknown",
          simulator: telemetry.simulator || "Unknown",
        },
        fuel: {
          level: telemetry.fuel?.level || 0,
          perLapAvg: telemetry.fuel?.perLapAvg || 0,
        },
      };

      // Si hay setup disponible, agregar datos completos
      if (setupData) {
        const setupSource =
          setupEnvelope?.type === 'LMU_SETUP' ? 'LMU'
          : setupEnvelope?.type === 'IRACING_SETUP' ? 'iRacing'
          : (telemetry.simulator || 'Unknown');
        const completeSetup = {
          ...baseData,
          setup: setupData,
          setupMeta: {
            source: setupSource,
            updateCount: setupEnvelope?.updateCount,
            timestamp: setupEnvelope?.timestamp,
          },
          note: `Complete setup data received (${setupSource})`,
          hasCompleteSetup: true
        };
        console.log('[getVehicleSetup] Returning complete setup:', Object.keys(completeSetup));
        return completeSetup;
      }

      // Sin setup, solo retornar datos básicos
      console.log('[getVehicleSetup] No setup available, returning basic data');
      return {
        ...baseData,
        note: "Basic vehicle info. Detailed setup not yet received from backend.",
      };
    }

    // ============================================================================
    // � CONTEXT UPDATES - Actualización periódica de contexto
    // ============================================================================

    /**
     * Determina el intervalo de context updates según tipo de sesión
     */
    private getContextUpdateInterval(): number {
      const sessionType = this.currentTelemetry?.session?.type?.toLowerCase() || '';

      // Carrera = 10s (actualización frecuente, situación dinámica)
      if (sessionType.includes('race')) {
        return 10 * 1000;
      }

      // Qualify = 15s (frecuente para análisis de sectores)
      if (sessionType.includes('qual')) {
        return 15 * 1000;
      }

      // Práctica, Testing = 30s (más relajado)
      return 30 * 1000;
    }

    /**
     * Construye mensaje de contexto rico y preciso para Gemini
     * Objetivo: Dar un "dibujo claro" del estado actual sin interpretaciones
     */
    private buildRichContextMessage(): string {
      const t = this.currentTelemetry;
      if (!t) return '';

      const lines: string[] = [];

      // === HEADER ===
      const simulator = t.simulator || 'Unknown';
      const sessionType = t.session?.type || 'Unknown';
      const sessionState = t.session?.state || 'unknown';
      lines.push(`[CONTEXTO - ${simulator}]`);
      lines.push(`Sesión: ${sessionType} (${sessionState})`);

      // === FLAGS & SPECIAL CONDITIONS ===
      const flags = t.flags?.active || [];
      const isPacing = sessionState === 'parade_laps' || sessionState === 'warmup';

      if (flags.length > 0 || isPacing) {
        const flagsSection: string[] = [];

        if (isPacing) {
          flagsSection.push('PACING LAP (formación/safety car)');
        }

        if (flags.includes('yellow') || flags.includes('caution')) {
          flagsSection.push('YELLOW FLAG');
        }
        if (flags.includes('blue')) {
          flagsSection.push('BLUE FLAG');
        }
        if (flags.includes('white')) {
          flagsSection.push('WHITE FLAG');
        }
        if (flags.includes('checkered')) {
          flagsSection.push('CHECKERED FLAG');
        }

        if (flagsSection.length > 0) {
          lines.push(`\n🚩 FLAGS: ${flagsSection.join(', ')}`);
        }
      }

      // === POSITION & SESSION ===
      const position = t.position?.overall || 0;
      const classPosition = t.position?.class || 0;
      const totalCars = t.position?.totalCars || 0;
      const currentLap = t.timing?.currentLap || 0;
      const lapsCompleted = t.timing?.lapsCompleted || 0;

      lines.push(`\n📍 POSICIÓN:`);
      lines.push(`Overall: P${position}/${totalCars}`);

      // Multiclass context
      if (classPosition !== position) {
        const myStanding = t.standings?.find(s => s.position === position);
        const className = myStanding?.carClass || 'Unknown';
        const classStandings = t.standings?.filter(s => s.carClass === className) || [];
        lines.push(`Clase ${className}: P${classPosition}/${classStandings.length}`);
      }

      lines.push(`Vuelta: ${currentLap} (${lapsCompleted} completadas)`);

      // Laps/time remaining
      const lapsRemaining = t.session?.lapsRemaining || 0;
      const timeRemaining = t.session?.timeRemaining || 0;
      if (lapsRemaining > 0 && lapsRemaining < 32767) {
        lines.push(`Restantes: ${lapsRemaining} vueltas`);
      } else if (timeRemaining > 0) {
        const mins = Math.floor(timeRemaining / 60);
        lines.push(`Restantes: ${mins}min`);
      }

      // === LAP TIMES ===
      lines.push(`\n⏱️ TIEMPOS:`);
      const lastLapTime = t.timing?.lastLapTime;
      const bestLapTime = t.timing?.bestLapTime;

      if (lastLapTime && lastLapTime > 0) {
        lines.push(`Last Lap: ${lastLapTime.toFixed(3)}s`);
      }
      if (bestLapTime && bestLapTime > 0) {
        lines.push(`Best Lap: ${bestLapTime.toFixed(3)}s`);
      }

      // === SECTORS (from standings) ===
      const myStanding = t.standings?.find(s => s.position === position);
      if (myStanding) {
        const s1 = myStanding.s1;
        const s2 = myStanding.s2;
        const s3 = myStanding.s3;

        const sectorsData: string[] = [];
        if (s1 && s1 > 0) sectorsData.push(`S1: ${s1.toFixed(3)}s`);
        if (s2 && s2 > 0) sectorsData.push(`S2: ${s2.toFixed(3)}s`);
        if (s3 && s3 > 0) sectorsData.push(`S3: ${s3.toFixed(3)}s`);

        if (sectorsData.length > 0) {
          lines.push(`Sectores: ${sectorsData.join(' | ')}`);
        }
      }

      // === FUEL ===
      const fuelLevel = t.fuel?.level || 0;
      const fuelUsedLastLap = t.fuel?.usedLastLap || 0;

      // Only show fuel if level > 0 (avoid spam during session changes)
      if (fuelLevel > 0) {
        lines.push(`\n⛽ FUEL:`);
        lines.push(`Nivel: ${fuelLevel.toFixed(1)}L`);
        if (fuelUsedLastLap > 0) {
          lines.push(`Consumo última vuelta: ${fuelUsedLastLap.toFixed(2)}L`);
        }
      }

      // === INCIDENTS ===
      const incidents = t.incidents?.count || 0;
      const incidentLimit = t.incidents?.limit || 0;
      if (incidentLimit > 0) {
        lines.push(`\n⚠️ INCIDENTES: ${incidents}/${incidentLimit}`);
      }

      // === TRACK CONDITIONS ===
      const trackTemp = t.track?.tempCelsius;
      const airTemp = t.track?.airTempCelsius;
      const wetness = t.track?.wetness || 0;

      if (trackTemp || airTemp) {
        lines.push(`\n🌡️ CONDICIONES:`);
        if (trackTemp) lines.push(`Pista: ${trackTemp.toFixed(0)}°C`);
        if (airTemp) lines.push(`Aire: ${airTemp.toFixed(0)}°C`);
        if (wetness > 0) {
          lines.push(`Pista mojada: ${(wetness * 100).toFixed(0)}%`);
        }
      }

      // === PIT STATUS ===
      const pitsOpen = t.pit?.pitsOpen ?? true;
      const inPitLane = t.pit?.inPitLane || false;

      if (!pitsOpen || inPitLane) {
        lines.push(`\n🔧 PITS:`);
        if (!pitsOpen) lines.push(`Estado: CERRADOS`);
        if (inPitLane) lines.push(`En pit lane`);
      }

      // === GAPS & RIVALS ===
      const isLoneQualy = sessionType.toLowerCase().includes('qual') && sessionType.toLowerCase().includes('lone');

      if (!isLoneQualy && t.standings && t.standings.length > 1) {
        lines.push(`\n🏁 GAPS:`);
        const myPos = position;
        const myGapToLeader = t.gaps?.toLeader || 0;
        const standings = t.standings.slice().sort((a, b) => a.position - b.position);

        // 2 adelante
        const ahead = standings.filter(s => s.position < myPos).slice(-2).reverse();
        if (ahead.length > 0) {
          ahead.forEach(s => {
            const gap = s.gapToLeader != null ? Math.abs(s.gapToLeader - myGapToLeader).toFixed(2) : 'N/A';
            const lastTime = s.lastTime && s.lastTime > 0 ? s.lastTime.toFixed(3) : 'N/A';
            lines.push(`  P${s.position} ${s.userName}: ${gap}s adelante (último: ${lastTime}s)`);
          });
        }

        // 2 atrás
        const behind = standings.filter(s => s.position > myPos).slice(0, 2);
        if (behind.length > 0) {
          behind.forEach(s => {
            const gap = s.gapToLeader != null ? Math.abs(s.gapToLeader - myGapToLeader).toFixed(2) : 'N/A';
            const lastTime = s.lastTime && s.lastTime > 0 ? s.lastTime.toFixed(3) : 'N/A';
            lines.push(`  P${s.position} ${s.userName}: ${gap}s atrás (último: ${lastTime}s)`);
          });
        }
      }

      return lines.join('\n');
    }

    /**
     * Inicia los context updates periódicos
     */
    private startContextUpdates(): void {
      this.stopContextUpdates(); // Limpiar timer anterior si existe
      
      // 🔒 FIX: Initialize timer to avoid huge first delta
      this.lastContextUpdateTime = Date.now();
      
      const interval = this.getContextUpdateInterval();
      const intervalSec = interval / 1000;
      
      console.log(`[ContextUpdates] ⏰ Starting periodic updates (${intervalSec}s interval)`);
      
      this.contextUpdateTimer = setInterval(() => {
        // Verificar que la sesión está activa
        if (!this.isSessionReady()) {
          console.log('[ContextUpdates] ⏸️ Skipped - session not ready');
          return;
        }
        
        // Pausar si está en boxes o sesión terminada
        const sessionState = this.currentTelemetry?.session?.state?.toLowerCase();
        if (sessionState === 'checkered' || sessionState === 'cooldown') {
          console.log('[ContextUpdates] ⏸️ Skipped - session finished');
          return;
        }
        
        // Construir y enviar mensaje
        // 🔧 FORMAT TIME FOR GEMINI: Ensure context updates are formatted
        const message = this.buildRichContextMessage();
        if (!message) {
          console.log('[ContextUpdates] ⏸️ Skipped - no data');
          return;
        }
        
        const now = Date.now();
        const timeSinceLast = (now - this.lastContextUpdateTime) / 1000;
        
        console.log(`[ContextUpdates] 📤 Sending context (${timeSinceLast.toFixed(1)}s since last)`);
        
        try {
          this.sendAndLog(
            {
              turns: [{
                role: "user",
                parts: [{ text: `[CONTEXTO]\n${message}` }]
              }],
            },
            'context_update_periodic',
            {
              interval: intervalSec,
              sessionType: this.currentTelemetry?.session?.type,
              timeSinceLast: timeSinceLast.toFixed(1) // ✅ FIXED: Delta in seconds, not Unix timestamp
            }
          );
          
          this.lastContextUpdateTime = now;
        } catch (error) {
          console.error('[ContextUpdates] ❌ Failed to send:', error);
          this.logEntry('error', 'context_update_periodic', `Failed: ${error}`);
        }
        
      }, interval);
    }

    /**
     * Detiene los context updates periódicos
     */
    private stopContextUpdates(): void {
      if (this.contextUpdateTimer) {
        clearInterval(this.contextUpdateTimer);
        this.contextUpdateTimer = null;
        console.log('[ContextUpdates] ⏹️ Stopped');
      }
    }

    // ============================================================================
    // �📝 DEBUG LOGGING SYSTEM
    // ============================================================================

    /**
     * Registra una entrada en el log de sesión
     * SOLO registra mensajes tipo 'sent' (lo que se envía a Gemini)
     */
    private logEntry(
      type: 'sent' | 'received' | 'error' | 'tool' | 'event',
      category: string,
      content: string,
      metadata?: Record<string, any>
    ): void {
      if (!this.loggingEnabled) return;

      const entry: GeminiLogEntry = {
        timestamp: new Date().toISOString(),
        type,
        category,
        content,
        metadata
      };

      this.sessionLogs.push(entry);

      // Mantener solo las últimas MAX_LOGS entradas
      if (this.sessionLogs.length > this.MAX_LOGS) {
        this.sessionLogs.shift();
      }

      // Avoid console spam: audio chunks can arrive many times per second.
      // Keep them in sessionLogs for file export, but don't print them.
      if (category === 'gemini_audio') {
        return;
      }

      // Log a consola con formato PLANO y legible
      const time = new Date(entry.timestamp).toLocaleTimeString('es-ES', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3
      });

      // Formato compacto
      const shortContent = content.length > 120 ? content.substring(0, 120) + '...' : content;
      const icon = type === 'sent' ? '📤' : type === 'received' ? '📥' : type === 'tool' ? '🔧' : type === 'error' ? '⚠️' : '🧩';
      console.log(`${icon} ${time} [${type.toUpperCase()}] ${category}`);
      console.log(`   ${shortContent}`);
      
      // Metadata en formato plano si existe
      if (metadata && Object.keys(metadata).length > 0) {
        const metaParts: string[] = [];
        for (const [key, value] of Object.entries(metadata)) {
          if (typeof value === 'object') {
            metaParts.push(`${key}=${JSON.stringify(value)}`);
          } else {
            metaParts.push(`${key}=${value}`);
          }
        }
        console.log(`   📎 ${metaParts.join(', ')}`);
      }
    }

    /**
     * 📤 HELPER: Envía contenido al modelo Y registra la inyección
     * Centraliza todas las llamadas a sendClientContent para logging consistente
     */
    private sendAndLog(
      content: { turns: any[]; turnComplete?: boolean },
      category: string,
      metadata?: Record<string, any>
    ): void {
      if (!this.session) {
        console.error('[GeminiLive] ❌ Cannot send: session not initialized');
        return;
      }

      // 🛡️ P0-FIX3: GLOBAL ANTI-SPAM GUARD - Prevenir mensajes en rápida sucesión
      const now = Date.now();
      const timeSinceLastMessage = now - this.lastMessageSentTime;
      const bypassThrottle = category === 'turn_complete_signal';
      if (!bypassThrottle && this.lastMessageSentTime > 0 && timeSinceLastMessage < this.MIN_MESSAGE_INTERVAL_MS) {
        console.warn(`[GeminiLive] 🛡️ Message THROTTLED (category: ${category}, ${(timeSinceLastMessage/1000).toFixed(1)}s < ${this.MIN_MESSAGE_INTERVAL_MS/1000}s)`);
        return;
      }
      this.lastMessageSentTime = now;

      // 🗣️ AUDIO GATING: si marcamos turnComplete=true, esperamos respuesta del modelo
      if (content.turnComplete === true) {
        this.expectedModelTurns++;
      }

      // Extraer el texto del primer turn para logging
      let textContent = '';
      if (content.turns && content.turns.length > 0) {
        const firstTurn = content.turns[0];
        if (firstTurn.parts && firstTurn.parts.length > 0) {
          const firstPart = firstTurn.parts[0];
          if (firstPart.text) {
            textContent = firstPart.text;
          } else if (firstPart.inlineData) {
            textContent = '[AUDIO DATA]';
          }
        }
      }

      // Registrar la inyección ANTES de enviar
      this.logEntry(
        'sent',
        category,
        textContent,
        {
          ...metadata,
          turnComplete: ('turnComplete' in content) ? content.turnComplete : undefined,
          turnCompletePresent: ('turnComplete' in content),
          turnsCount: content.turns.length,
          contentLength: textContent.length
        }
      );

      // Enviar al modelo
      try {
        this.session.sendClientContent(content);
        this.lastTurnTime = new Date();
      } catch (error) {
        console.error(`[GeminiLive] ❌ Failed to send ${category}:`, error);
        this.logEntry('error', category, `Send failed: ${error}`, metadata);
        throw error;
      }
    }

    /**
     * Obtiene todos los logs de la sesión actual
     */
    public getSessionLogs(): GeminiLogEntry[] {
      return [...this.sessionLogs];
    }

    /**
     * Limpia los logs de la sesión
     */
    public clearSessionLogs(): void {
      this.sessionLogs = [];
      console.log('🗑️ Session logs cleared');
    }

    /**
     * Exporta logs como JSON para debugging externo
     */
    public exportLogsAsJson(): string {
      return JSON.stringify(this.sessionLogs, null, 2);
    }

    /**
     * Activa/desactiva el logging
     */
    public setLogging(enabled: boolean): void {
      this.loggingEnabled = enabled;
      console.log(`📝 Logging ${enabled ? 'enabled' : 'disabled'}`);
    }

    /**
     * Obtiene resumen de actividad
     * NOTA: Solo se registran mensajes tipo 'sent' (enviados a Gemini)
     */
    public getLogSummary(): {
      total: number;
      sent: number;
      received: number;
      errors: number;
      tools: number;
      events: number;
    } {
      const counts = {
        sent: 0,
        received: 0,
        error: 0,
        tool: 0,
        event: 0,
      };
      for (const log of this.sessionLogs) {
        if (log.type === 'sent') counts.sent++;
        else if (log.type === 'received') counts.received++;
        else if (log.type === 'error') counts.error++;
        else if (log.type === 'tool') counts.tool++;
        else if (log.type === 'event') counts.event++;
      }
      return {
        total: this.sessionLogs.length,
        sent: counts.sent,
        received: counts.received,
        errors: counts.error,
        tools: counts.tool,
        events: counts.event,
      };
    }

    // ============================================================================
    // 📁 FILE LOGGING SYSTEM
    // ============================================================================

    /**
     * Inicializa el sistema de guardado automático de logs en archivo
     */
    private async initializeFileLogging(): Promise<void> {
      if (!this.fileLoggingEnabled) return;

      // Generar nombre de archivo con timestamp
      const now = new Date();
      const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, -5);
      this.logFilePath = `gemini-logs-${timestamp}.json`;

      console.log(`📁 File logging initialized: ${this.logFilePath}`);
      console.log(`📁 Logs will be saved every ${this.FILE_LOGGING_INTERVAL_MS / 1000}s`);
      
      // Mostrar directorio de guardado si Electron está disponible
      if (window.electronAPI?.getLogsDirectory) {
        try {
          const logsDir = await window.electronAPI.getLogsDirectory();
          console.log(`📁 Logs directory: ${logsDir}`);
        } catch (error) {
          console.warn('📁 Could not get logs directory:', error);
        }
      }

      // Iniciar timer de guardado periódico
      this.startFileLoggingTimer();
    }

    /**
     * Inicia el timer de guardado periódico
     */
    private startFileLoggingTimer(): void {
      if (this.fileLoggingInterval) {
        clearInterval(this.fileLoggingInterval);
      }

      this.fileLoggingInterval = setInterval(() => {
        this.saveLogsToFile();
      }, this.FILE_LOGGING_INTERVAL_MS);
    }

    /**
     * Detiene el timer de guardado periódico
     */
    private stopFileLoggingTimer(): void {
      if (this.fileLoggingInterval) {
        clearInterval(this.fileLoggingInterval);
        this.fileLoggingInterval = null;
      }
    }

    /**
     * Guarda los logs actuales en un archivo JSON usando Electron IPC
     */
    private async saveLogsToFile(): Promise<void> {
      if (!this.fileLoggingEnabled || this.sessionLogs.length === 0) {
        return;
      }

      try {
        const logsData = {
          sessionInfo: {
            instanceId: this.instanceId,
            startTime: this.connectionMetrics.connectionStartTime,
            totalConnections: this.connectionMetrics.totalConnections,
            totalDisconnections: this.connectionMetrics.totalDisconnections,
            totalErrors: this.connectionMetrics.totalErrors,
          },
          summary: this.getLogSummary(),
          logs: this.sessionLogs,
        };

        // ✅ Usar Electron IPC si está disponible (modo aplicación)
        if (window.electronAPI?.saveGeminiLogs) {
          const filepath = await window.electronAPI.saveGeminiLogs(logsData);
          console.log(`📁 Logs saved to file: ${filepath} (${this.sessionLogs.length} entries)`);
        } else {
          // Fallback: navegador sin Electron (modo desarrollo web)
          console.log(`📁 ${this.sessionLogs.length} logs ready (Electron not available)`);
          
          // Guardar en localStorage como backup
          try {
            const jsonContent = JSON.stringify(logsData, null, 2);
            localStorage.setItem('gemini-logs-latest', jsonContent);
            console.log(`📁 Backup saved to localStorage`);
          } catch (storageError) {
            console.warn('📁 localStorage full, backup not saved:', storageError);
          }
        }
      } catch (error) {
        console.error('📁 Failed to save logs:', error);
      }
    }

    /**
     * Exporta logs manualmente a un archivo descargable
     */
    public async downloadLogsAsFile(): Promise<void> {
      if (this.sessionLogs.length === 0) {
        console.warn('📁 No logs to download');
        return;
      }

      try {
        const logsData = {
          sessionInfo: {
            instanceId: this.instanceId,
            startTime: new Date(this.connectionMetrics.connectionStartTime).toISOString(),
            duration: Date.now() - this.connectionMetrics.connectionStartTime,
            totalConnections: this.connectionMetrics.totalConnections,
            totalDisconnections: this.connectionMetrics.totalDisconnections,
            totalErrors: this.connectionMetrics.totalErrors,
          },
          summary: this.getLogSummary(),
          logs: this.sessionLogs,
        };

        const jsonContent = JSON.stringify(logsData, null, 2);
        const blob = new Blob([jsonContent], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = this.logFilePath;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        console.log(`📁 Logs downloaded: ${this.logFilePath} (${this.sessionLogs.length} entries)`);
      } catch (error) {
        console.error('📁 Failed to download logs:', error);
      }
    }

    /**
     * Activa/desactiva el guardado automático en archivo
     */
    public setFileLogging(enabled: boolean): void {
      this.fileLoggingEnabled = enabled;
      
      if (enabled) {
        this.startFileLoggingTimer();
        console.log('📁 File logging enabled');
      } else {
        this.stopFileLoggingTimer();
        console.log('📁 File logging disabled');
      }
    }
  }



