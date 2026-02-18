import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { TTSProvider, SynthesisOptions, TTSProviderConfig } from './tts-provider.js';

/**
 * Eleven Labs TTS configuration
 */
interface ElevenLabsConfig extends TTSProviderConfig {
  stability?: number;       // 0-1, default 0.5
  similarityBoost?: number; // 0-1, default 0.75
}

interface ElevenLabsResponse {
  audio?: string;     // Base64 encoded PCM audio
  isFinal?: boolean;
  error?: string;
  message?: string;   // Error message from API
}

/**
 * ElevenLabsTTSService
 *
 * Eleven Labs WebSocket streaming TTS.
 * Unlike Cartesia, Eleven Labs requires a fresh WebSocket per synthesis request —
 * the connection is not kept alive between calls. This class hides that detail
 * behind the same TTSProvider interface.
 */
export class ElevenLabsTTSService extends EventEmitter implements TTSProvider {
  private config: Required<ElevenLabsConfig>;
  private activeWs: WebSocket | null = null;
  private isStreaming: boolean = false;
  private isIntentionallyClosed: boolean = false;
  private pendingChunks: SynthesisOptions[] = [];

  constructor(config: ElevenLabsConfig) {
    super();

    this.config = {
      apiKey: config.apiKey,
      modelId: config.modelId || 'eleven_turbo_v2_5',
      voiceId: config.voiceId || 'pNInz6obpgDQGcFmaJgB',
      language: config.language || 'es',
      sampleRate: config.sampleRate || 48000,
      encoding: config.encoding || 'pcm_44100',  // Best quality compatible with 48kHz playback
      stability: config.stability ?? 0.5,
      similarityBoost: config.similarityBoost ?? 0.75,
    };

    console.log(`[ElevenLabs] Initialized — model: ${this.config.modelId}, voice: ${this.config.voiceId}, format: ${this.config.encoding}`);
  }

  /**
   * connect() is a no-op for Eleven Labs — connections are per-synthesis.
   * We emit 'connected' immediately so the pipeline works identically to Cartesia.
   */
  public async connect(): Promise<void> {
    this.isIntentionallyClosed = false;
    console.log('[ElevenLabs] Ready (connections opened per synthesis request)');
    this.emit('connected');
  }

  /**
   * Disconnect — cancel any active synthesis and mark as closed.
   */
  public disconnect(): void {
    this.isIntentionallyClosed = true;
    this.closeActiveWs();
    console.log('[ElevenLabs] Disconnected');
    this.emit('disconnected');
  }

  /**
   * Synthesize text. Opens a fresh WebSocket to Eleven Labs.
   */
  public synthesize(options: SynthesisOptions | string): void {
    const opts: SynthesisOptions = typeof options === 'string' ? { text: options } : options;

    if (this.isIntentionallyClosed) {
      console.warn('[ElevenLabs] Cannot synthesize: disconnected');
      return;
    }

    if (this.isStreaming) {
      this.pendingChunks.push(opts);
      return;
    }

    this.runSynthesis(opts);
  }

  /**
   * Open a WebSocket, send the text, collect audio chunks, close when done.
   */
  private runSynthesis(options: SynthesisOptions): void {
    this.isStreaming = true;

    const wsUrl = `wss://api.elevenlabs.io/v1/text-to-speech/${this.config.voiceId}/stream-input`
      + `?model_id=${this.config.modelId}`
      + `&output_format=${this.config.encoding}`;

    console.log(`[ElevenLabs] Opening WS for synthesis: "${options.text.slice(0, 60)}..."`);
    console.log(`[ElevenLabs] URL: ${wsUrl}`);

    const ws = new WebSocket(wsUrl, {
      headers: { 'xi-api-key': this.config.apiKey },
    });

    this.activeWs = ws;

    ws.on('open', () => {
      console.log('[ElevenLabs] WS open — sending text');

      // 1. Send the BOS (beginning-of-stream) message with voice settings
      ws.send(JSON.stringify({
        text: ' ',
        voice_settings: {
          stability: this.config.stability,
          similarity_boost: this.config.similarityBoost,
          style: 0,
          use_speaker_boost: true,
        },
        generation_config: {
          chunk_length_schedule: [50],  // Generate audio ASAP (low latency)
        },
      }));

      // 2. Send the actual text with flush=true to force immediate generation
      const text = options.text.trimEnd() + ' ';
      ws.send(JSON.stringify({
        text,
        flush: true,
      }));

      // 3. Send EOS (end-of-stream)
      ws.send(JSON.stringify({ text: '' }));
    });

    ws.on('message', (raw: WebSocket.Data) => {
      let response: ElevenLabsResponse;
      try {
        response = JSON.parse(raw.toString());
      } catch {
        console.error('[ElevenLabs] Failed to parse message:', raw.toString().slice(0, 200));
        return;
      }

      // API-level error
      if (response.error || response.message) {
        const msg = response.error || response.message || 'Unknown API error';
        console.error('[ElevenLabs] API error:', msg);
        this.emit('error', new Error(msg));
        this.isStreaming = false;
        ws.close();
        return;
      }

      // Audio chunk
      if (response.audio) {
        const buf = Buffer.from(response.audio, 'base64');
        console.log(`[ElevenLabs] Audio chunk: ${buf.length} bytes`);
        this.emit('audioChunk', buf);
      }

      // Final message — synthesis complete
      if (response.isFinal) {
        console.log('[ElevenLabs] isFinal received — synthesis done');
        this.emit('chunkDone');
        this.isStreaming = false;
        ws.close();

        if (this.pendingChunks.length > 0) {
          const next = this.pendingChunks.shift()!;
          this.runSynthesis(next);
        } else {
          this.emit('completed');
        }
      }
    });

    ws.on('error', (err: Error) => {
      console.error('[ElevenLabs] WS error:', err.message);
      this.isStreaming = false;
      this.emit('error', err);
    });

    ws.on('close', (code: number, reason: Buffer) => {
      const r = reason.toString();
      console.log(`[ElevenLabs] WS closed: ${code}${r ? ' — ' + r : ''}`);
      this.activeWs = null;

      // If we closed before isFinal arrived, treat as error
      if (this.isStreaming) {
        this.isStreaming = false;
        this.emit('error', new Error(`WS closed before synthesis finished (code ${code})`));
      }
    });
  }

  /**
   * Cancel active synthesis.
   */
  public cancel(): void {
    console.log('[ElevenLabs] Cancelling synthesis');
    this.pendingChunks = [];
    this.closeActiveWs();
    this.isStreaming = false;
    this.emit('cancelled');
  }

  private closeActiveWs(): void {
    if (this.activeWs) {
      try {
        if (this.activeWs.readyState === WebSocket.OPEN) {
          this.activeWs.close();
        }
      } catch { /* ignore */ }
      this.activeWs = null;
    }
  }

  public isConnected(): boolean {
    return !this.isIntentionallyClosed;
  }

  public getIsStreaming(): boolean {
    return this.isStreaming;
  }

  public getSampleRate(): number {
    // Derive sample rate from encoding string (e.g. "pcm_16000" → 16000)
    const match = this.config.encoding.match(/(\d+)$/);
    return match ? parseInt(match[1], 10) : this.config.sampleRate;
  }
}
