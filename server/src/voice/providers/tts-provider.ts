import { EventEmitter } from 'events';

/**
 * TTS synthesis options (common interface for all providers)
 */
export interface SynthesisOptions {
  text: string;
  emotion?: 'neutral' | 'calm' | 'content' | 'excited' | 'scared' | 'angry' | 'sad';
  speed?: number;  // 0.7 to 1.5 (normalized range)
}

/**
 * Common TTS provider interface
 *
 * Events:
 * - 'connected': Connected to TTS service
 * - 'disconnected': Disconnected from TTS service
 * - 'audioChunk': (pcmBuffer: Buffer) - Raw PCM audio chunk received
 * - 'chunkDone': Current synthesis chunk completed
 * - 'completed': All synthesis completed
 * - 'cancelled': Synthesis cancelled
 * - 'error': (error: Error) - Error occurred
 */
export interface TTSProvider extends EventEmitter {
  /**
   * Connect to TTS service
   */
  connect(): Promise<void>;

  /**
   * Disconnect from TTS service
   */
  disconnect(): void;

  /**
   * Synthesize text to speech
   * @param options - Text and optional emotion/speed parameters
   */
  synthesize(options: SynthesisOptions | string): void;

  /**
   * Cancel current synthesis and clear queue
   */
  cancel(): void;

  /**
   * Check if connected to TTS service
   */
  isConnected(): boolean;

  /**
   * Check if currently streaming audio
   */
  getIsStreaming(): boolean;

  /**
   * Get the sample rate (Hz) of PCM audio produced by this provider
   */
  getSampleRate(): number;
}

/**
 * Base TTS provider configuration
 */
export interface TTSProviderConfig {
  apiKey: string;
  modelId?: string;
  voiceId?: string;
  language?: string;
  sampleRate?: number;
  encoding?: string;
}
