/**
 * VoiceIntegrationService integrates all voice pipeline components
 * Connects: VoicePipeline (WebSocket) + MicCapture + AudioPlayback
 */

import { VoicePipelineService, VoiceState } from './voice-pipeline';
import { MicCaptureService } from './mic-capture';
import { AudioPlaybackService } from './audio-playback';

export interface VoiceIntegrationCallbacks {
  onTranscriptPartial?: (text: string, confidence: number | null) => void;
  onTranscriptFinal?: (text: string, confidence: number | null) => void;
  onSpeakingChange?: (speaking: boolean) => void;
  onStateChange?: (state: VoiceState) => void;
  onError?: (scope: string, message: string) => void;
}

export class VoiceIntegrationService {
  private voicePipeline: VoicePipelineService;
  private micCapture: MicCaptureService;
  private audioPlayback: AudioPlaybackService;

  private isInitialized: boolean = false;
  private micEnabled: boolean = false;

  constructor(serverUrl: string = 'ws://localhost:8081/voice') {
    this.voicePipeline = new VoicePipelineService(serverUrl);
    this.micCapture = new MicCaptureService();
    this.audioPlayback = new AudioPlaybackService();
  }

  /**
   * Initialize all components
   */
  public async initialize(callbacks: VoiceIntegrationCallbacks = {}): Promise<void> {
    if (this.isInitialized) {
      console.log('[VoiceIntegration] Already initialized');
      return;
    }

    try {
      console.log('[VoiceIntegration] Initializing...');

      // Initialize components
      await Promise.all([
        this.micCapture.initialize(),
        this.audioPlayback.initialize(),
      ]);

      // Setup VoicePipeline callbacks
      this.voicePipeline.setCallbacks({
        onTranscriptPartial: callbacks.onTranscriptPartial,
        onTranscriptFinal: callbacks.onTranscriptFinal,
        onSpeakingChange: callbacks.onSpeakingChange,
        onStateChange: callbacks.onStateChange,
        onError: callbacks.onError,
      });

      // Connect mic capture to voice pipeline
      this.micCapture.onAudioChunk((chunk) => {
        this.voicePipeline.sendAudio(chunk);
      });

      // Barge-in disabled - it was detecting its own audio output
      // this.micCapture.onVadChange((active) => {
      //   if (active && this.audioPlayback.getIsPlaying()) {
      //     console.log('[VoiceIntegration] Barge-in detected');
      //     this.voicePipeline.interrupt('vad_voice');
      //     this.audioPlayback.fadeOut(0.15);
      //   }
      // });

      // Connect voice pipeline audio to playback
      this.voicePipeline.onAudioChunk((chunk, sampleRate) => {
        this.audioPlayback.playPcm16Chunk(chunk, sampleRate);
      });

      // Notify when audio actually finishes playing (not just when server is done sending)
      this.audioPlayback.onPlaybackEnd(() => {
        callbacks.onSpeakingChange?.(false);
      });

      // Connect to server
      this.voicePipeline.connect();

      this.isInitialized = true;
      console.log('[VoiceIntegration] Initialized successfully');

    } catch (error) {
      console.error('[VoiceIntegration] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Set mic enabled (PTT control)
   */
  public setMicEnabled(enabled: boolean): void {
    if (!this.isInitialized) {
      console.warn('[VoiceIntegration] Not initialized');
      return;
    }

    this.micEnabled = enabled;

    if (enabled) {
      // IMPORTANT: Send control message BEFORE starting capture to avoid race condition
      this.voicePipeline.setMicEnabled(true);
      this.micCapture.startCapture();
    } else {
      this.micCapture.stopCapture();
      this.voicePipeline.setMicEnabled(false);
    }

    console.log(`[VoiceIntegration] Mic ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Get mic enabled state
   */
  public isMicEnabled(): boolean {
    return this.micEnabled;
  }

  /**
   * Get current voice pipeline state
   */
  public getState(): VoiceState | null {
    return this.voicePipeline.getState();
  }

  /**
   * Check if connected to server
   */
  public isConnected(): boolean {
    return this.voicePipeline.isConnected();
  }

  /**
   * Set playback volume
   */
  public setVolume(volume: number): void {
    this.audioPlayback.setVolume(volume);
  }

  /**
   * Get playback volume
   */
  public getVolume(): number {
    return this.audioPlayback.getVolume();
  }

  /**
   * Set VAD threshold (for barge-in sensitivity)
   */
  public setVadThreshold(threshold: number): void {
    this.micCapture.setVadThreshold(threshold);
  }

  /**
   * Get VAD threshold
   */
  public getVadThreshold(): number {
    return this.micCapture.getVadThreshold();
  }

  /**
   * Stop playback (manual interrupt)
   */
  public stopPlayback(): void {
    this.audioPlayback.stop();
  }

  /**
   * Disconnect and cleanup
   */
  public dispose(): void {
    console.log('[VoiceIntegration] Disposing...');

    this.voicePipeline.disconnect();
    this.micCapture.dispose();
    this.audioPlayback.dispose();

    this.isInitialized = false;
    this.micEnabled = false;

    console.log('[VoiceIntegration] Disposed');
  }
}
