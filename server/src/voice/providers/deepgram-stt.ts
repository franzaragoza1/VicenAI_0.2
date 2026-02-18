import WebSocket from 'ws';
import { EventEmitter } from 'events';

/**
 * Deepgram STT configuration
 */
interface DeepgramConfig {
  apiKey: string;
  model?: string;
  language?: string;
  sampleRate?: number;
  channels?: number;
  encoding?: string;
  punctuate?: boolean;
  interimResults?: boolean;
  endpointing?: number;  // ms of silence to detect end of speech
  smartFormat?: boolean;
  vadEvents?: boolean;
}

/**
 * Deepgram response types
 */
interface DeepgramAlternative {
  transcript: string;
  confidence: number;
}

interface DeepgramChannel {
  alternatives: DeepgramAlternative[];
}

interface DeepgramMessage {
  type: 'Results' | 'UtteranceEnd' | 'SpeechStarted' | 'Metadata';
  channel?: DeepgramChannel;
  is_final?: boolean;
  speech_final?: boolean;
}

/**
 * DeepgramSTTService manages speech-to-text streaming via Deepgram WebSocket API
 */
export class DeepgramSTTService extends EventEmitter {
  private ws: WebSocket | null = null;
  private config: Required<DeepgramConfig>;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 1000;  // Start with 1s
  private isConnecting: boolean = false;
  private isIntentionallyClosed: boolean = false;
  private micEnabled: boolean = false;
  private audioBuffer: Buffer = Buffer.alloc(0);
  private readonly BUFFER_TARGET = 2048;
  private audioBytesSent: number = 0;
  private sendCount: number = 0;
  private chunkCounter: number = 0;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: DeepgramConfig) {
    super();

    // Apply defaults
    this.config = {
      apiKey: config.apiKey,
      model: config.model || 'nova-2',
      language: config.language || 'es',
      sampleRate: config.sampleRate || 16000,
      channels: config.channels || 1,
      encoding: config.encoding || 'linear16',
      punctuate: config.punctuate ?? true,
      interimResults: config.interimResults ?? true,
      endpointing: config.endpointing ?? 300,  // 300ms silence
      smartFormat: config.smartFormat ?? true,
      vadEvents: config.vadEvents ?? true,
    };
  }

  /**
   * Connect to Deepgram WebSocket API
   */
  public async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log('[DeepgramSTT] Already connected');
      return;
    }

    if (this.isConnecting) {
      console.log('[DeepgramSTT] Connection already in progress');
      return;
    }

    this.isConnecting = true;
    this.isIntentionallyClosed = false;

    try {
      const wsUrl = this.buildWebSocketUrl();
      console.log('[DeepgramSTT] Connecting to Deepgram...');

      this.ws = new WebSocket(wsUrl, {
        headers: {
          'Authorization': `Token ${this.config.apiKey}`,
        },
      });

      this.setupWebSocketHandlers();

      // Wait for connection to open
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Connection timeout'));
        }, 10000);

        this.ws!.once('open', () => {
          clearTimeout(timeout);
          resolve();
        });

        this.ws!.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });

      this.reconnectAttempts = 0;
      this.reconnectDelay = 1000;
      this.isConnecting = false;

      console.log('[DeepgramSTT] Connected successfully');

      // Start KeepAlive timer to prevent inactivity timeout
      this.startKeepAlive();

      // Flush any buffered audio that arrived while connecting
      if (this.audioBuffer.length > 0) {
        console.log(`[DeepgramSTT] Flushing ${this.audioBuffer.length} bytes buffered during connection`);
        this.flushBuffer();
      }

      this.emit('connected');

    } catch (error) {
      this.isConnecting = false;
      console.error('[DeepgramSTT] Connection failed:', error);
      this.emit('error', error);

      // Attempt reconnect with exponential backoff
      if (!this.isIntentionallyClosed && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.scheduleReconnect();
      }
    }
  }

  /**
   * Build WebSocket URL with query parameters
   */
  private buildWebSocketUrl(): string {
    const url = new URL('wss://api.deepgram.com/v1/listen');

    url.searchParams.set('model', this.config.model);
    url.searchParams.set('language', this.config.language);
    url.searchParams.set('encoding', this.config.encoding);
    url.searchParams.set('sample_rate', this.config.sampleRate.toString());
    url.searchParams.set('channels', this.config.channels.toString());
    url.searchParams.set('punctuate', this.config.punctuate.toString());
    url.searchParams.set('interim_results', this.config.interimResults.toString());
    url.searchParams.set('endpointing', this.config.endpointing.toString());
    url.searchParams.set('smart_format', this.config.smartFormat.toString());
    url.searchParams.set('vad_events', this.config.vadEvents.toString());

    return url.toString();
  }

  /**
   * Setup WebSocket event handlers
   */
  private setupWebSocketHandlers(): void {
    if (!this.ws) return;

    this.ws.on('open', () => {
      console.log('[DeepgramSTT] WebSocket opened');
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      try {
        const message = JSON.parse(data.toString()) as DeepgramMessage;
        this.handleDeepgramMessage(message);
      } catch (error) {
        console.error('[DeepgramSTT] Failed to parse message:', error);
      }
    });

    this.ws.on('close', (code: number, reason: Buffer) => {
      console.log(`[DeepgramSTT] WebSocket closed: ${code} - ${reason.toString()}`);
      this.emit('disconnected');

      // Attempt reconnect if not intentionally closed
      if (!this.isIntentionallyClosed && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.scheduleReconnect();
      }
    });

    this.ws.on('error', (error: Error) => {
      console.error('[DeepgramSTT] WebSocket error:', error);
      this.emit('error', error);
    });
  }

  /**
   * Handle messages from Deepgram
   */
  private handleDeepgramMessage(message: DeepgramMessage): void {
    if (message.type === 'Results' && message.channel) {
      const alternatives = message.channel.alternatives;
      if (alternatives && alternatives.length > 0) {
        const transcript = alternatives[0].transcript;
        const confidence = alternatives[0].confidence;

        if (transcript.trim().length === 0) {
          return;  // Skip empty transcripts
        }

        if (message.is_final) {
          // Final transcript
          console.log(`[DeepgramSTT] Final transcript: "${transcript}" (confidence: ${confidence})`);
          this.emit('final', transcript, confidence);

          // Check if this is end of utterance (speech_final)
          if (message.speech_final) {
            console.log('[DeepgramSTT] Utterance ended (speech_final)');
            this.emit('utteranceEnd');
          }
        } else {
          // Partial/interim transcript
          console.log(`[DeepgramSTT] Partial transcript: "${transcript}"`);
          this.emit('partial', transcript, confidence);
        }
      }
    } else if (message.type === 'UtteranceEnd') {
      console.log('[DeepgramSTT] Utterance ended (explicit event)');
      this.emit('utteranceEnd');
    } else if (message.type === 'SpeechStarted') {
      console.log('[DeepgramSTT] Speech started');
      this.emit('speechStarted');
    } else if (message.type === 'Metadata') {
      // Metadata message (connection info, etc.)
      console.log('[DeepgramSTT] Metadata received');
    }
  }

  /**
   * Send audio chunk to Deepgram
   */
  public sendAudio(chunk: Buffer): void {
    // Log EVERY incoming chunk (first 5 only) for diagnosis
    if (this.chunkCounter < 5) {
      console.log(`[DeepgramSTT] 🎧 Chunk #${++this.chunkCounter}: size=${chunk.length}B, bufferBefore=${this.audioBuffer.length}B, wsState=${this.ws?.readyState}, micEnabled=${this.micEnabled}`);
    }

    // Always buffer audio, even if not ready to send yet
    this.audioBuffer = Buffer.concat([this.audioBuffer, chunk]);

    // Only send if connected and mic enabled
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // Buffer will be sent when connection opens
      return;
    }

    if (!this.micEnabled) {
      // Buffer will be sent when mic is enabled
      return;
    }

    // Send buffered chunks when ready
    this.flushBuffer();
  }

  /**
   * Flush buffered audio to Deepgram
   */
  private flushBuffer(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    // Send all complete chunks
    while (this.audioBuffer.length >= this.BUFFER_TARGET) {
      const toSend = this.audioBuffer.subarray(0, this.BUFFER_TARGET);
      this.audioBuffer = this.audioBuffer.subarray(this.BUFFER_TARGET);
      this.ws.send(toSend);
      this.sendCount++;
      this.audioBytesSent += this.BUFFER_TARGET;

      if (this.sendCount === 1) {
        console.log(`[DeepgramSTT] ✅ First buffered chunk sent to Deepgram: ${this.BUFFER_TARGET} bytes`);
      }
    }

    // Log periodically
    if (this.sendCount > 0 && this.sendCount % 50 === 0) {
      console.log(`[DeepgramSTT] Sent ${this.sendCount} buffered chunks (${(this.audioBytesSent / 1024).toFixed(0)}KB total)`);
    }
  }

  /**
   * Set mic enabled state
   */
  public setMicEnabled(enabled: boolean): void {
    console.log(`[DeepgramSTT] 🎤 Mic enabled changed: ${this.micEnabled} → ${enabled}`);
    this.micEnabled = enabled;

    if (enabled) {
      // Flush any buffered audio when mic is enabled
      if (this.audioBuffer.length > 0) {
        console.log(`[DeepgramSTT] Flushing ${this.audioBuffer.length} bytes buffered before mic enabled`);
        this.flushBuffer();
      }
    } else {
      // Flush remaining buffered audio and send Finalize to get final transcript
      if (this.audioBuffer.length > 0 && this.ws && this.ws.readyState === WebSocket.OPEN) {
        console.log(`[DeepgramSTT] Flushing ${this.audioBuffer.length} bytes on mic disable`);
        this.ws.send(this.audioBuffer);
        this.audioBuffer = Buffer.alloc(0);
      }
      this.finalize();
    }
  }

  /**
   * Send Finalize message to Deepgram (flush pending transcription without closing connection)
   */
  public finalize(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    console.log('[DeepgramSTT] Sending Finalize message');
    this.ws.send(JSON.stringify({ type: 'Finalize' }));
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(): void {
    this.reconnectAttempts++;

    console.log(`[DeepgramSTT] Scheduling reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${this.reconnectDelay}ms`);

    setTimeout(() => {
      this.connect().catch(error => {
        console.error('[DeepgramSTT] Reconnect failed:', error);
      });
    }, this.reconnectDelay);

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 16000);
  }

  /**
   * Start KeepAlive timer to prevent Deepgram inactivity timeout
   */
  private startKeepAlive(): void {
    this.stopKeepAlive();
    this.keepAliveTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'KeepAlive' }));
      }
    }, 8000); // Every 8 seconds (Deepgram timeout is ~10-15s)
  }

  /**
   * Stop KeepAlive timer
   */
  private stopKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  /**
   * Disconnect from Deepgram
   */
  public disconnect(): void {
    this.isIntentionallyClosed = true;
    this.stopKeepAlive();

    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) {
        // Send Finalize before closing
        this.finalize();

        // Wait a bit for Finalize to be sent
        setTimeout(() => {
          if (this.ws) {
            this.ws.close();
            this.ws = null;
          }
        }, 100);
      } else {
        this.ws = null;
      }
    }

    console.log('[DeepgramSTT] Disconnected');
  }

  /**
   * Check if connected
   */
  public isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
