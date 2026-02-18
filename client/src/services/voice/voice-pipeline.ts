/**
 * VoicePipelineService manages the WebSocket connection to the voice pipeline
 */

export interface VoicePipelineCallbacks {
  onTranscriptPartial?: (text: string, confidence: number | null) => void;
  onTranscriptFinal?: (text: string, confidence: number | null) => void;
  onLLMDelta?: (text: string) => void;
  onLLMDone?: (text: string, duration: number) => void;
  onStateChange?: (state: VoiceState) => void;
  onSpeakingChange?: (speaking: boolean) => void;
  onError?: (scope: string, message: string, recoverable: boolean) => void;
}

export interface VoiceState {
  stt: 'connected' | 'disconnected' | 'error';
  llm: 'idle' | 'streaming' | 'error';
  tts: 'idle' | 'streaming' | 'error';
  micEnabled: boolean;
  speaking: boolean;
}

export class VoicePipelineService {
  private ws: WebSocket | null = null;
  private wsUrl: string;
  private callbacks: VoicePipelineCallbacks = {};
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 1000;
  private isIntentionallyClosed: boolean = false;
  private currentState: VoiceState | null = null;

  // TTS audio debug counters (helps detect truncation between server->client)
  private currentTtsUtteranceId: number | null = null;
  private currentTtsRxChunks: number = 0;
  private currentTtsRxBytes: number = 0;

  // Audio playback (will be set externally)
  private onAudioChunkCallback: ((chunk: ArrayBuffer, sampleRate: number) => void) | null = null;

  // Current TTS sample rate (from tts_audio_start)
  private currentTtsSampleRate: number = 48000;

  constructor(wsUrl: string) {
    this.wsUrl = wsUrl;
  }

  /**
   * Set callbacks
   */
  public setCallbacks(callbacks: VoicePipelineCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * Set audio chunk callback (for playback)
   */
  public onAudioChunk(callback: (chunk: ArrayBuffer, sampleRate: number) => void): void {
    this.onAudioChunkCallback = callback;
  }

  /**
   * Connect to voice pipeline WebSocket
   */
  public connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      console.log('[VoicePipeline] Already connected or connecting');
      return;
    }

    this.isIntentionallyClosed = false;

    try {
      console.log('[VoicePipeline] Connecting to', this.wsUrl);
      this.ws = new WebSocket(this.wsUrl);

      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        console.log('[VoicePipeline] Connected');
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;

        // Send hello message
        this.sendJSON({
          type: 'hello',
          protocolVersion: 1,
          client: 'renderer',
          capabilities: {
            binaryAudio: true,
          },
        });
      };

      this.ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
          // JSON control message
          this.handleControlMessage(JSON.parse(event.data));
        } else {
          // Binary audio data (PCM16@48kHz from TTS)
          // Handle both ArrayBuffer and Blob (Electron compatibility)
          if (event.data instanceof Blob) {
            event.data.arrayBuffer().then((ab) => {
              if (this.currentTtsUtteranceId !== null) {
                this.currentTtsRxChunks++;
                this.currentTtsRxBytes += ab.byteLength;
              }
              if (this.onAudioChunkCallback) this.onAudioChunkCallback(ab, this.currentTtsSampleRate);
            });
          } else {
            if (this.currentTtsUtteranceId !== null) {
              const ab = event.data as ArrayBuffer;
              this.currentTtsRxChunks++;
              this.currentTtsRxBytes += ab.byteLength;
            }
            if (this.onAudioChunkCallback) this.onAudioChunkCallback(event.data, this.currentTtsSampleRate);
          }
        }
      };

      this.ws.onclose = () => {
        console.log('[VoicePipeline] Connection closed');
        this.ws = null;

        if (!this.isIntentionallyClosed && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (error) => {
        console.error('[VoicePipeline] WebSocket error:', error);
      };

    } catch (error) {
      console.error('[VoicePipeline] Connection failed:', error);
      if (!this.isIntentionallyClosed && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.scheduleReconnect();
      }
    }
  }

  /**
   * Handle JSON control messages from server
   */
  private handleControlMessage(message: any): void {
    switch (message.type) {
      case 'ready':
        console.log('[VoicePipeline] Server ready, protocol version:', message.protocolVersion);
        break;

      case 'state':
        this.currentState = {
          stt: message.stt,
          llm: message.llm,
          tts: message.tts,
          micEnabled: message.micEnabled,
          speaking: message.speaking,
        };

        if (this.callbacks.onStateChange) {
          this.callbacks.onStateChange(this.currentState);
        }

        // Only fire onSpeakingChange(true) here — speaking=false is handled by
        // AudioPlaybackService.onPlaybackEnd so the orb stays green until audio finishes
        if (this.callbacks.onSpeakingChange && message.speaking === true) {
          this.callbacks.onSpeakingChange(true);
        }
        break;

      case 'stt_partial':
        if (this.callbacks.onTranscriptPartial) {
          this.callbacks.onTranscriptPartial(message.text, message.confidence);
        }
        break;

      case 'stt_final':
        if (this.callbacks.onTranscriptFinal) {
          this.callbacks.onTranscriptFinal(message.text, message.confidence);
        }
        break;

      case 'llm_delta':
        if (this.callbacks.onLLMDelta) {
          this.callbacks.onLLMDelta(message.text);
        }
        break;

      case 'llm_done':
        console.log(`[VoicePipeline] LLM complete message:\n"${message.text}"\n(${message.durationMs}ms)`);
        if (this.callbacks.onLLMDone) {
          this.callbacks.onLLMDone(message.text, message.durationMs);
        }
        break;

      case 'tts_audio_start':
        this.currentTtsUtteranceId = message.utteranceId;
        this.currentTtsRxChunks = 0;
        this.currentTtsRxBytes = 0;
        if (message.sampleRate) {
          this.currentTtsSampleRate = message.sampleRate;
        }
        break;

      case 'tts_audio_done': {
        const rxChunks = this.currentTtsRxChunks;
        const rxBytes = this.currentTtsRxBytes;
        const expectedChunks = message.chunks as number;
        const expectedBytes = message.bytes as number;

        if (message.utteranceId !== this.currentTtsUtteranceId) {
          console.warn(
            `[VoicePipeline] TTS done utteranceId mismatch (server=${message.utteranceId}, client=${this.currentTtsUtteranceId})`
          );
        }

        if (rxChunks !== expectedChunks || rxBytes !== expectedBytes) {
          console.warn(
            `[VoicePipeline] TTS audio truncated? expected ${expectedChunks} chunks/${expectedBytes}B, ` +
            `received ${rxChunks} chunks/${rxBytes}B (utteranceId=${message.utteranceId})`
          );
        }

        this.currentTtsUtteranceId = null;
        break;
      }

      case 'error':
        console.error(`[VoicePipeline] Error from ${message.scope}:`, message.message);
        if (this.callbacks.onError) {
          this.callbacks.onError(message.scope, message.message, message.recoverable);
        }
        break;

      default:
        console.warn('[VoicePipeline] Unknown message type:', message.type);
    }
  }

  /**
   * Send JSON control message to server
   */
  private sendJSON(message: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Send binary audio data to server (PCM16@16kHz from mic)
   */
  public sendAudio(pcm16Data: ArrayBuffer): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(pcm16Data);
    } else {
      // Don't log - this happens frequently during reconnection
    }
  }

  /**
   * Set mic enabled state (PTT control)
   */
  public setMicEnabled(enabled: boolean): void {
    this.sendJSON({
      type: 'mic_state',
      enabled,
      mode: 'open_mic',
    });
  }

  /**
   * Send interrupt signal (for barge-in)
   */
  public interrupt(reason: 'vad_voice' | 'ptt_on'): void {
    this.sendJSON({
      type: 'interrupt',
      reason,
    });
  }

  /**
   * Disconnect from voice pipeline
   */
  public disconnect(): void {
    this.isIntentionallyClosed = true;

    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }

    console.log('[VoicePipeline] Disconnected');
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(): void {
    this.reconnectAttempts++;

    console.log(
      `[VoicePipeline] Scheduling reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${this.reconnectDelay}ms`
    );

    setTimeout(() => {
      this.connect();
    }, this.reconnectDelay);

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 16000);
  }

  /**
   * Check if connected
   */
  public isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Get current state
   */
  public getState(): VoiceState | null {
    return this.currentState;
  }
}

