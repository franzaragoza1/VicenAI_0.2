import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { TTSProvider, SynthesisOptions, TTSProviderConfig } from './tts-provider.js';

/**
 * Cartesia TTS configuration (extends base config)
 */
interface CartesiaConfig extends TTSProviderConfig {}

/**
 * Cartesia TTS chunk request
 */
interface CartesiaChunkRequest {
  model_id: string;
  transcript: string;
  voice: {
    mode: 'id';
    id: string;
  };
  output_format: {
    container: 'raw';
    encoding: string;
    sample_rate: number;
  };
  language?: string;  // Optional: omit for auto-detection
  context_id: string;
  continue: boolean;
  generation_config?: {
    speed?: number;      // 0.7 to 1.5
    emotion?: string;    // 'neutral', 'calm', 'content', 'excited', 'scared', 'angry', 'sad'
  };
}

/**
 * Cartesia TTS response
 */
interface CartesiaResponse {
  type: 'chunk' | 'done' | 'error';
  data?: string;  // Base64 PCM audio
  context_id?: string;
  error?: string;
}

/**
 * CartesiaTTSService handles text-to-speech streaming via Cartesia WebSocket API
 */
export class CartesiaTTSService extends EventEmitter {
  private ws: WebSocket | null = null;
  private config: Required<CartesiaConfig>;
  private contextId: string | null = null;
  private isFirstChunk: boolean = true;
  private pendingChunks: SynthesisOptions[] = [];
  private isStreaming: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 1000;
  private isIntentionallyClosed: boolean = false;
  private isConnecting: boolean = false;

  constructor(config: CartesiaConfig) {
    super();

    this.config = {
      apiKey: config.apiKey,
      modelId: config.modelId || 'sonic-3',
      voiceId: config.voiceId || 'a0e99841-438c-4a64-b679-ae501e7d6091',  // Spanish male
      language: config.language || 'es',
      sampleRate: config.sampleRate || 24000,
      encoding: config.encoding || 'pcm_s16le',
    };

    console.log(`[CartesiaTTS] Initialized with model: ${this.config.modelId}, voice: ${this.config.voiceId}, language: ${this.config.language}`);
  }

  /**
   * Connect to Cartesia WebSocket API
   */
  public async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log('[CartesiaTTS] Already connected');
      return;
    }

    if (this.isConnecting) {
      console.log('[CartesiaTTS] Connection already in progress');
      return;
    }

    this.isConnecting = true;
    this.isIntentionallyClosed = false;

    try {
      console.log('[CartesiaTTS] Connecting to Cartesia...');

      this.ws = new WebSocket('wss://api.cartesia.ai/tts/websocket', {
        headers: {
          'Cartesia-Version': '2024-06-10',
          'X-API-Key': this.config.apiKey,
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

      console.log('[CartesiaTTS] Connected successfully');
      this.emit('connected');

    } catch (error) {
      this.isConnecting = false;
      console.error('[CartesiaTTS] Connection failed:', error);
      this.emit('error', error);

      // Attempt reconnect with exponential backoff
      if (!this.isIntentionallyClosed && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.scheduleReconnect();
      }
    }
  }

  /**
   * Setup WebSocket event handlers
   */
  private setupWebSocketHandlers(): void {
    if (!this.ws) return;

    this.ws.on('open', () => {
      console.log('[CartesiaTTS] WebSocket opened');
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      try {
        const response = JSON.parse(data.toString()) as CartesiaResponse;
        this.handleCartesiaResponse(response);
      } catch (error) {
        console.error('[CartesiaTTS] Failed to parse message:', error);
      }
    });

    this.ws.on('close', (code: number, reason: Buffer) => {
      console.log(`[CartesiaTTS] WebSocket closed: ${code} - ${reason.toString()}`);
      this.emit('disconnected');

      // Attempt reconnect if not intentionally closed
      if (!this.isIntentionallyClosed && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.scheduleReconnect();
      }
    });

    this.ws.on('error', (error: Error) => {
      console.error('[CartesiaTTS] WebSocket error:', error);
      this.emit('error', error);
    });
  }

  /**
   * Handle response from Cartesia
   */
  private handleCartesiaResponse(response: CartesiaResponse): void {
    if (response.type === 'chunk' && response.data) {
      // Decode base64 PCM to Buffer
      const pcmBuffer = Buffer.from(response.data, 'base64');

      // Emit audio chunk
      this.emit('audioChunk', pcmBuffer);

    } else if (response.type === 'done') {
      console.log('[CartesiaTTS] Chunk synthesis completed');
      this.emit('chunkDone');

      // Process next pending chunk if any
      if (this.pendingChunks.length > 0) {
        const nextChunk = this.pendingChunks.shift()!;
        this.sendChunk(nextChunk);
      } else {
        // All chunks completed
        this.isStreaming = false;
        this.isFirstChunk = true;
        this.contextId = null;
        console.log('[CartesiaTTS] All synthesis completed');
        this.emit('completed');
      }

    } else if (response.type === 'error') {
      console.error('[CartesiaTTS] Synthesis error:', response.error);
      this.emit('error', new Error(response.error || 'Unknown TTS error'));
      this.isStreaming = false;
    }
  }

  /**
   * Synthesize text chunk with optional emotion and speed
   */
  public synthesize(options: SynthesisOptions | string): void {
    // Support legacy string parameter
    const opts: SynthesisOptions = typeof options === 'string'
      ? { text: options }
      : options;

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[CartesiaTTS] Cannot synthesize: not connected');
      this.pendingChunks.push(opts);
      return;
    }

    if (this.isStreaming) {
      // Queue chunk for later
      this.pendingChunks.push(opts);
      return;
    }

    this.sendChunk(opts);
  }

  /**
   * Send chunk to Cartesia
   */
  private sendChunk(options: SynthesisOptions): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    // Generate or reuse context_id for continuations
    if (this.isFirstChunk || !this.contextId) {
      this.contextId = uuidv4();
    }

    // TypeScript guard: contextId is guaranteed to be non-null here
    const contextId = this.contextId!;

    const request: CartesiaChunkRequest = {
      model_id: this.config.modelId,
      transcript: options.text,
      voice: {
        mode: 'id',
        id: this.config.voiceId,
      },
      output_format: {
        container: 'raw',
        encoding: this.config.encoding,
        sample_rate: this.config.sampleRate,
      },
      context_id: contextId,
      continue: !this.isFirstChunk,  // Use continuation for subsequent chunks
    };

    // Add generation config if emotion or speed specified
    if (options.emotion || options.speed) {
      request.generation_config = {};
      if (options.emotion && options.emotion !== 'neutral') {
        request.generation_config.emotion = options.emotion;
      }
      if (options.speed && options.speed !== 1.0) {
        request.generation_config.speed = options.speed;
      }
    }

    const emotionInfo = options.emotion ? ` [${options.emotion}]` : '';
    const speedInfo = options.speed ? ` [${options.speed}x]` : '';
    console.log(`[CartesiaTTS] Synthesizing: "${options.text.slice(0, 50)}..."${emotionInfo}${speedInfo} (continue: ${!this.isFirstChunk})`);

    this.ws.send(JSON.stringify(request));
    this.isStreaming = true;
    this.isFirstChunk = false;
  }

  /**
   * Cancel current synthesis and clear queue
   */
  public cancel(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    if (this.contextId) {
      console.log('[CartesiaTTS] Cancelling synthesis');

      // Send cancel message
      this.ws.send(JSON.stringify({
        context_id: this.contextId,
        cancel: true,
      }));
    }

    // Clear state
    this.pendingChunks = [];
    this.isStreaming = false;
    this.isFirstChunk = true;
    this.contextId = null;

    this.emit('cancelled');
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(): void {
    this.reconnectAttempts++;

    console.log(`[CartesiaTTS] Scheduling reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${this.reconnectDelay}ms`);

    setTimeout(() => {
      this.connect().catch(error => {
        console.error('[CartesiaTTS] Reconnect failed:', error);
      });
    }, this.reconnectDelay);

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 16000);
  }

  /**
   * Disconnect from Cartesia
   */
  public disconnect(): void {
    this.isIntentionallyClosed = true;

    // Cancel any ongoing synthesis
    this.cancel();

    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }

    console.log('[CartesiaTTS] Disconnected');
  }

  /**
   * Check if connected
   */
  public isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Check if currently streaming
   */
  public getIsStreaming(): boolean {
    return this.isStreaming;
  }

  public getSampleRate(): number {
    return this.config.sampleRate;
  }
}
