/**
 * Telemetry Client Service
 * ========================
 * 
 * Simple WebSocket client that receives iRacing telemetry from server
 * and forwards it to Gemini Live service.
 * 
 * Also handles spotter audio events for critical race callouts.
 * Now also receives SimHub rich telemetry (sectors, fuel calc, etc.)
 */

import type { TelemetryMessage, TelemetryData, TelemetryEvent, SimHubTelemetry, SimHubMessage } from '../types/telemetry.types';
import { getSpotterService, SpotterAudioService } from './elevenlabs-tts';

// ============================================================================
// TYPES
// ============================================================================

export interface TelemetryClientOptions {
  /** WebSocket URL (default: ws://localhost:8080/telemetry) */
  url?: string;
  /** Auto-reconnect on disconnect */
  autoReconnect?: boolean;
  /** Reconnect delay in ms */
  reconnectDelay?: number;
  /** Enable debug logging */
  debug?: boolean;
}

export interface TelemetryClientCallbacks {
  /** Called when telemetry snapshot received */
  onSnapshot?: (data: TelemetryData) => void;
  /** Called when telemetry event received */
  onEvent?: (event: any, data: TelemetryData) => void;
  /** Called when connection state changes */
  onConnectionChange?: (connected: boolean) => void;
  /** Called on error */
  onError?: (error: Error) => void;
  /** Called when session_joined event received (full participant table) */
  onSessionJoined?: (eventData: any) => void;
  /** Called when race events occur that Gemini should react to */
  onRaceEvent?: (eventType: string, eventData: any, telemetry: TelemetryData) => void;
  /** Called when SimHub telemetry received (rich data with sectors, etc.) */
  onSimHubTelemetry?: (data: any) => void;
}

// ============================================================================
// TELEMETRY CLIENT CLASS
// ============================================================================

export class TelemetryClient {
  private ws: WebSocket | null = null;
  private url: string;
  private autoReconnect: boolean;
  private reconnectDelay: number;
  private debug: boolean;
  private callbacks: TelemetryClientCallbacks;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isConnecting: boolean = false;
  private lastTelemetry: TelemetryData | null = null;
  
  // 🔊 Spotter service for audio callouts
  private spotterService: SpotterAudioService | null = null;
  private spotterInitialized: boolean = false;
  
  // 🔊 Spotter state tracking (for detecting changes)
  private prevSpotterLeft: boolean = false;
  private prevSpotterRight: boolean = false;
  private spotterCooldown: boolean = false;  // Prevent rapid-fire audio
  private lastSpotterCall: string = '';
  private lastSpotterTime: number = 0;

  constructor(
    callbacks: TelemetryClientCallbacks = {},
    options: TelemetryClientOptions = {}
  ) {
    this.url = options.url ?? 'ws://localhost:8081/telemetry';
    this.autoReconnect = options.autoReconnect ?? true;
    this.reconnectDelay = options.reconnectDelay ?? 3000;
    this.debug = options.debug ?? false;
    this.callbacks = callbacks;
    
    // Initialize spotter lazily (needs user interaction for AudioContext)
    this.spotterService = getSpotterService();
  }

  /**
   * Initialize spotter audio (must be called after user interaction)
   */
  async initializeSpotter(): Promise<void> {
    if (this.spotterInitialized) return;
    
    try {
      await this.spotterService?.initialize();
      this.spotterInitialized = true;
      console.log('[TelemetryClient] 🔊 Spotter audio initialized');
    } catch (error) {
      console.error('[TelemetryClient] ❌ Failed to initialize spotter:', error);
    }
  }

  /**
   * Connect to telemetry WebSocket
   */
  connect(): void {
    if (this.isConnecting || this.ws?.readyState === WebSocket.OPEN) {
      this.log('Already connected or connecting');
      return;
    }

    this.isConnecting = true;
    this.log(`Connecting to ${this.url}...`);

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this.isConnecting = false;
        this.log('✅ Connected to telemetry service');
        this.callbacks.onConnectionChange?.(true);
        
        // Clear any pending reconnect
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      this.ws.onclose = () => {
        this.isConnecting = false;
        this.log('Connection closed');
        this.callbacks.onConnectionChange?.(false);
        this.scheduleReconnect();
      };

      this.ws.onerror = (event) => {
        this.isConnecting = false;
        const error = new Error('WebSocket error');
        this.log('Error:', error.message);
        this.callbacks.onError?.(error);
      };

    } catch (error) {
      this.isConnecting = false;
      this.log('Connection failed:', error);
      this.callbacks.onError?.(error as Error);
      this.scheduleReconnect();
    }
  }

  /**
   * Disconnect from telemetry WebSocket
   */
  disconnect(): void {
    this.autoReconnect = false;
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.log('Disconnected');
    this.callbacks.onConnectionChange?.(false);
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Get last received telemetry
   */
  getLastTelemetry(): TelemetryData | null {
    return this.lastTelemetry;
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(rawData: string): void {
    try {
      const message = JSON.parse(rawData);
      
      // Handle regular telemetry messages
      const telemetryMessage = message as TelemetryMessage;
      
      if (telemetryMessage.type === 'snapshot') {
        this.lastTelemetry = telemetryMessage.data;
        this.callbacks.onSnapshot?.(telemetryMessage.data);
        this.log(`📊 Snapshot received (lap ${telemetryMessage.data.timing?.currentLap})`);
      } 
      else if (telemetryMessage.type === 'event') {
        this.lastTelemetry = telemetryMessage.data;
        this.callbacks.onEvent?.(telemetryMessage.event, telemetryMessage.data);
        console.log(`🎯 [TelemetryClient] Event: ${telemetryMessage.event?.type}`, telemetryMessage.event?.data);
        
        // 📋 SESSION JOINED - Forward full participant table
        if (telemetryMessage.event?.type === 'session_joined') {
          console.log('[TelemetryClient] 📋 Session joined event received!');
          this.callbacks.onSessionJoined?.(telemetryMessage.event.data);
        }
        
        // 🏎️ RACE EVENTS - Forward important events to Gemini for proactive communication
        const raceEventTypes = ['position_change', 'flag_change', 'lap_complete', 'pit_entry', 'pit_exit', 'incident', 'session_state_change'];
        if (raceEventTypes.includes(telemetryMessage.event?.type)) {
          console.log(`[TelemetryClient] 🏁 Race event for Gemini: ${telemetryMessage.event.type}`);
          this.callbacks.onRaceEvent?.(telemetryMessage.event.type, telemetryMessage.event.data, telemetryMessage.data);
        }
        
        // 🔊 SPOTTER: Reproducir audio para eventos críticos
        this.handleSpotterEvent(telemetryMessage.event);
      }

    } catch (error) {
      this.log('Parse error:', error);
    }
  }

  /**
   * 🔊 Handle spotter audio for telemetry events
   */
  private handleSpotterEvent(event: TelemetryEvent): void {
    if (!this.spotterInitialized || !this.spotterService) {
      return;
    }
    
    // 🚗 PROXIMITY SPOTTER - car_left, car_right, three_wide, clear, etc.
    if (event.type === 'spotter') {
      const call = event.data?.call as string;
      
      // Update our internal tracking state if proximity data is provided
      if (event.data?.proximity) {
        const proximity = event.data.proximity as any;
        this.prevSpotterLeft = proximity.car_left;
        this.prevSpotterRight = proximity.car_right;
      }
      
      if (call) {
        console.log(`[Spotter] 🔊 Proximity call: ${call}`);
        this.spotterService.playSpotterPhrase(call).catch(err => {
          console.warn(`[Spotter] ⚠️ Failed to play ${call}:`, err.message);
        });
      }
      return;
    }
    
    // Map other event types to spotter audio keys
    const spotterKeyMap: Record<string, string> = {
      'flag_change': this.getFlagAudioKey(event.data),
      'pit_entry': 'pit_entry',
      'pit_exit': 'pit_exit',
      'incident': 'damage', // Use damage audio for incidents
      'lap_complete': 'copy', // Acknowledge lap completion
    };
    
    const audioKey = spotterKeyMap[event.type];
    if (!audioKey) return;
    
    console.log(`[Spotter] 🔊 Playing: ${audioKey} for event: ${event.type}`);
    
    this.spotterService.playSpotterPhrase(audioKey).catch(err => {
      console.warn(`[Spotter] ⚠️ Failed to play ${audioKey}:`, err.message);
    });
  }

  /**
   * Get spotter audio key for flag changes
   */
  private getFlagAudioKey(data: Record<string, unknown>): string {
    const flags = data.flags as string[] | undefined;
    if (!flags || flags.length === 0) return '';
    
    // Priority order for flag audio
    const flagPriority = ['yellow', 'caution', 'blue', 'white', 'checkered', 'green', 'black', 'red'];
    
    for (const priority of flagPriority) {
      if (flags.some(f => f.toLowerCase().includes(priority))) {
        return `${priority}_flag`;
      }
    }
    
    return '';
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    if (!this.autoReconnect || this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);

    this.log(`Reconnecting in ${this.reconnectDelay}ms...`);
  }

  /**
   * Debug logging
   */
  private log(...args: any[]): void {
    if (this.debug) {
      console.log('[TelemetryClient]', ...args);
    }
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let clientInstance: TelemetryClient | null = null;

/**
 * Get or create the singleton telemetry client
 */
export function getTelemetryClient(): TelemetryClient | null {
  return clientInstance;
}

/**
 * Initialize spotter audio (call after user interaction)
 */
export async function initSpotterAudio(): Promise<void> {
  if (clientInstance) {
    await clientInstance.initializeSpotter();
  }
}

/**
 * Initialize the telemetry client with Gemini integration
 * Call this once at app startup
 */
export function initTelemetryClient(
  geminiUpdateCallback: (data: TelemetryData) => void,
  options: TelemetryClientOptions = {},
  simhubCallback?: (data: SimHubTelemetry) => void,
  sessionJoinedCallback?: (eventData: any) => void,
  raceEventCallback?: (eventType: string, eventData: any, telemetry: TelemetryData) => void
): TelemetryClient {
  // Clean up existing instance
  if (clientInstance) {
    clientInstance.disconnect();
  }

  clientInstance = new TelemetryClient(
    {
      onSnapshot: (data) => {
        // Forward all snapshots to Gemini
        geminiUpdateCallback(data);
      },
      onEvent: (event, data) => {
        // Forward events to Gemini (includes full telemetry)
        geminiUpdateCallback(data);
      },
      onConnectionChange: (connected) => {
        console.log(`[Telemetry] Connection: ${connected ? '🟢 Connected' : '🔴 Disconnected'}`);
      },
      onError: (error) => {
        console.error('[Telemetry] Error:', error.message);
      },
      onSimHubTelemetry: simhubCallback ? (data) => {
        // Forward SimHub telemetry (rich data with sectors, etc.)
        simhubCallback(data);
      } : undefined,
      onSessionJoined: sessionJoinedCallback ? (eventData) => {
        // Forward session_joined event with full participant table
        sessionJoinedCallback(eventData);
      } : undefined,
      onRaceEvent: raceEventCallback ? (eventType, eventData, telemetry) => {
        // Forward race events for Gemini proactive communication
        raceEventCallback(eventType, eventData, telemetry);
      } : undefined,
    },
    {
      debug: true,
      ...options,
    }
  );

  clientInstance.connect();
  return clientInstance;
}

/**
 * Destroy the telemetry client
 */
export function destroyTelemetryClient(): void {
  if (clientInstance) {
    clientInstance.disconnect();
    clientInstance = null;
  }
}

export default TelemetryClient;
