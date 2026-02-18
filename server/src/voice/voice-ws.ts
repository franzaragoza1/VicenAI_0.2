import WebSocket from 'ws';
import { EventEmitter } from 'events';

/**
 * Protocol messages between client and server
 */
interface HelloMessage {
  type: 'hello';
  protocolVersion: number;
  client: string;
  capabilities: {
    binaryAudio: boolean;
  };
}

interface MicStateMessage {
  type: 'mic_state';
  enabled: boolean;
  mode: 'open_mic';
}

interface InterruptMessage {
  type: 'interrupt';
  reason: 'vad_voice' | 'ptt_on';
}

type ClientMessage = HelloMessage | MicStateMessage | InterruptMessage;

interface ReadyMessage {
  type: 'ready';
  protocolVersion: number;
}

interface StateMessage {
  type: 'state';
  stt: 'connected' | 'disconnected' | 'error';
  llm: 'idle' | 'streaming' | 'error';
  tts: 'idle' | 'streaming' | 'error';
  micEnabled: boolean;
  speaking: boolean;
}

interface STTPartialMessage {
  type: 'stt_partial';
  text: string;
  confidence: number | null;
}

interface STTFinalMessage {
  type: 'stt_final';
  text: string;
  confidence: number | null;
}

interface LLMDeltaMessage {
  type: 'llm_delta';
  text: string;
}

interface LLMDoneMessage {
  type: 'llm_done';
  text: string;
  durationMs: number;
}

interface TTSAudioStartMessage {
  type: 'tts_audio_start';
  utteranceId: number;
  sampleRate: number;
  encoding: 'pcm_s16le';
  channels: 1;
}

interface TTSAudioDoneMessage {
  type: 'tts_audio_done';
  utteranceId: number;
  chunks: number;
  bytes: number;
  durationMs: number;
}

interface ErrorMessage {
  type: 'error';
  scope: 'stt' | 'llm' | 'tts' | 'pipeline';
  message: string;
  recoverable: boolean;
}

type ServerMessage = ReadyMessage | StateMessage | STTPartialMessage | STTFinalMessage |
                     LLMDeltaMessage | LLMDoneMessage |
                     TTSAudioStartMessage | TTSAudioDoneMessage |
                     ErrorMessage;

/**
 * VoiceSession manages a single WebSocket connection for voice pipeline
 */
export class VoiceSession extends EventEmitter {
  private ws: WebSocket;
  private sessionId: string;
  private micEnabled: boolean = false;
  private sttConnected: boolean = false;
  private llmActive: boolean = false;
  private ttsActive: boolean = false;
  private protocolVersion: number = 1;

  constructor(ws: WebSocket, sessionId: string) {
    super();
    this.ws = ws;
    this.sessionId = sessionId;

    this.setupWebSocket();
  }

  private setupWebSocket(): void {
    this.ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        // Binary audio data
        this.handleBinaryMessage(data);
      } else {
        // JSON control message
        try {
          const message = JSON.parse(data.toString()) as ClientMessage;
          this.handleControlMessage(message);
        } catch (error) {
          console.error(`[VoiceSession ${this.sessionId}] Failed to parse message:`, error);
        }
      }
    });

    this.ws.on('close', () => {
      console.log(`[VoiceSession ${this.sessionId}] Connection closed`);
      this.emit('close');
    });

    this.ws.on('error', (error) => {
      console.error(`[VoiceSession ${this.sessionId}] WebSocket error:`, error);
      this.emit('error', error);
    });
  }

  private handleControlMessage(message: ClientMessage): void {
    switch (message.type) {
      case 'hello':
        this.handleHello(message);
        break;
      case 'mic_state':
        this.handleMicState(message);
        break;
      case 'interrupt':
        this.handleInterrupt(message);
        break;
      default:
        console.warn(`[VoiceSession ${this.sessionId}] Unknown message type:`, (message as any).type);
    }
  }

  private handleHello(message: HelloMessage): void {
    console.log(`[VoiceSession ${this.sessionId}] Client hello:`, message);
    this.protocolVersion = message.protocolVersion;

    // Send ready response
    const response: ReadyMessage = {
      type: 'ready',
      protocolVersion: 1,
    };
    this.sendJSON(response);

    // Send initial state
    this.sendState();
  }

  private handleMicState(message: MicStateMessage): void {
    console.log(`[VoiceSession ${this.sessionId}] 🎤 Mic state message received: ${message.enabled}`);
    this.micEnabled = message.enabled;

    this.emit('micStateChange', message.enabled);
    this.sendState();
  }

  private handleInterrupt(message: InterruptMessage): void {
    console.log(`[VoiceSession ${this.sessionId}] Interrupt:`, message.reason);
    this.emit('interrupt', message.reason);
  }

  private handleBinaryMessage(data: Buffer): void {
    // Emit audio chunk for STT processing
    this.emit('audioChunk', data);
  }

  /**
   * Send JSON control message to client
   */
  public sendJSON(message: ServerMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      const payload = JSON.stringify(message);
      this.ws.send(payload, (err) => {
        if (err) {
          console.error(`[VoiceSession ${this.sessionId}] Failed to send JSON:`, err);
        }
      });
    }
  }

  /**
   * Send binary audio data to client (from TTS)
   */
  public sendBinaryAudio(data: Buffer): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      // Basic backpressure visibility (useful when debugging truncation/early closes)
      const buffered = (this.ws as any).bufferedAmount as number | undefined;
      if (typeof buffered === 'number' && buffered > 2_000_000) {
        console.warn(`[VoiceSession ${this.sessionId}] High ws.bufferedAmount=${buffered}B while sending audio (${data.length}B)`);
      }

      this.ws.send(data, (err) => {
        if (err) {
          console.error(`[VoiceSession ${this.sessionId}] Failed to send binary audio:`, err);
        }
      });
    }
  }

  /**
   * Send current state to client
   */
  public sendState(): void {
    const state: StateMessage = {
      type: 'state',
      stt: this.sttConnected ? 'connected' : 'disconnected',
      llm: this.llmActive ? 'streaming' : 'idle',
      tts: this.ttsActive ? 'streaming' : 'idle',
      micEnabled: this.micEnabled,
      speaking: this.ttsActive,
    };
    this.sendJSON(state);
  }

  /**
   * Send STT partial transcript
   */
  public sendSTTPartial(text: string, confidence: number | null): void {
    const message: STTPartialMessage = {
      type: 'stt_partial',
      text,
      confidence,
    };
    this.sendJSON(message);
  }

  /**
   * Send STT final transcript
   */
  public sendSTTFinal(text: string, confidence: number | null): void {
    const message: STTFinalMessage = {
      type: 'stt_final',
      text,
      confidence,
    };
    this.sendJSON(message);
  }

  /**
   * Send LLM text delta (streaming)
   */
  public sendLLMDelta(text: string): void {
    const message: LLMDeltaMessage = {
      type: 'llm_delta',
      text,
    };
    this.sendJSON(message);
  }

  /**
   * Send LLM completion
   */
  public sendLLMDone(text: string, durationMs: number): void {
    const message: LLMDoneMessage = {
      type: 'llm_done',
      text,
      durationMs,
    };
    this.sendJSON(message);
  }

  /**
   * Send error message
   */
  public sendError(scope: ErrorMessage['scope'], message: string, recoverable: boolean): void {
    const errorMsg: ErrorMessage = {
      type: 'error',
      scope,
      message,
      recoverable,
    };
    this.sendJSON(errorMsg);
  }

  /**
   * Update connection states
   */
  public setSTTConnected(connected: boolean): void {
    this.sttConnected = connected;
    this.sendState();
  }

  public setLLMActive(active: boolean): void {
    this.llmActive = active;
    this.sendState();
  }

  public setTTSActive(active: boolean): void {
    this.ttsActive = active;
    this.sendState();
  }

  /**
   * Getters
   */
  public getSessionId(): string {
    return this.sessionId;
  }

  public isMicEnabled(): boolean {
    return this.micEnabled;
  }

  public isTTSActive(): boolean {
    return this.ttsActive;
  }

  public isConnected(): boolean {
    return this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Close the session
   */
  public close(): void {
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close();
    }
  }
}

/**
 * VoiceSessionManager manages all active voice sessions
 */
export class VoiceSessionManager {
  private sessions: Map<string, VoiceSession> = new Map();
  private nextSessionId: number = 1;

  /**
   * Create a new session for a WebSocket connection
   */
  public createSession(ws: WebSocket): VoiceSession {
    const sessionId = `voice-${this.nextSessionId++}`;
    const session = new VoiceSession(ws, sessionId);

    session.on('close', () => {
      this.sessions.delete(sessionId);
      console.log(`[VoiceSessionManager] Session ${sessionId} removed. Active sessions: ${this.sessions.size}`);
    });

    this.sessions.set(sessionId, session);
    console.log(`[VoiceSessionManager] Session ${sessionId} created. Active sessions: ${this.sessions.size}`);

    return session;
  }

  /**
   * Get all active sessions
   */
  public getSessions(): VoiceSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Close all sessions
   */
  public closeAll(): void {
    for (const session of this.sessions.values()) {
      session.close();
    }
    this.sessions.clear();
  }
}
