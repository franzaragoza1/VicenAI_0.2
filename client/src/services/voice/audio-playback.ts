/**
 * AudioPlaybackService - Simple audio playback with RadioFX
 * Receives complete phrase buffers and plays them sequentially
 */

export class AudioPlaybackService {
  private audioContext: AudioContext | null = null;
  private radioBus: GainNode | null = null;
  private playbackGain: GainNode | null = null;

  // Decoded FX buffers (loaded once at init)
  private fxOpen: AudioBuffer | null = null;   // FX1 — opens/closes engineer messages
  private fxStatic: AudioBuffer | null = null; // STATICFX — loops under voice

  // Static loop state
  private staticSource: AudioBufferSourceNode | null = null;
  private staticGain: GainNode | null = null;

  // Streaming scheduler state (gapless playback)
  private nextStartTimeSec: number = 0;
  private activeSources: Set<AudioBufferSourceNode> = new Set();
  private isPlaying: boolean = false;
  private readonly minLeadTimeSec: number = 0.05;
  private onPlaybackEndCallback: (() => void) | null = null;

  public async initialize(): Promise<void> {
    if (this.audioContext) return;

    this.audioContext = new AudioContext();
    this.setupRadioEffects();
    await this.loadFX();
  }

  private setupRadioEffects(): void {
    if (!this.audioContext) throw new Error('AudioContext not initialized');

    this.radioBus = this.audioContext.createGain();

    // HP at 300 Hz
    const highPass = this.audioContext.createBiquadFilter();
    highPass.type = 'highpass';
    highPass.frequency.value = 250;
    highPass.Q.value = 0.5;

    // LP at 4800 Hz
    const lowPass = this.audioContext.createBiquadFilter();
    lowPass.type = 'lowpass';
    lowPass.frequency.value = 6000;
    lowPass.Q.value = 0.5;

    // Soft saturation
    const distortion = this.audioContext.createWaveShaper();
    distortion.curve = this.makeSoftSaturationCurve(10);
    distortion.oversample = '2x';

    // Compressor
    const compressor = this.audioContext.createDynamicsCompressor();
    compressor.threshold.value = -25;
    compressor.knee.value = 6;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.15;

    const finalGain = this.audioContext.createGain();
    finalGain.gain.value = 1.4;

    this.playbackGain = this.audioContext.createGain();
    this.playbackGain.gain.value = 2;

    this.radioBus.connect(highPass);
    highPass.connect(lowPass);
    lowPass.connect(distortion);
    distortion.connect(compressor);
    compressor.connect(finalGain);
    finalGain.connect(this.playbackGain);
    this.playbackGain.connect(this.audioContext.destination);
  }

  private makeSoftSaturationCurve(amount: number): Float32Array<ArrayBuffer> {
    const n = 4096;
    const curve = new Float32Array(n) as Float32Array<ArrayBuffer>;
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = (x * (1 + amount * 0.5)) / (1 + amount * Math.abs(x));
    }
    return curve;
  }

  /**
   * Load all FX files from public/audio/FX/
   */
  private async loadFX(): Promise<void> {
    if (!this.audioContext) return;

    const load = async (path: string): Promise<AudioBuffer | null> => {
      try {
        const res = await fetch(path);
        const ab = await res.arrayBuffer();
        return await this.audioContext!.decodeAudioData(ab);
      } catch (e) {
        console.warn(`[AudioPlayback] Failed to load FX: ${path}`, e);
        return null;
      }
    };

    [this.fxOpen, this.fxStatic] = await Promise.all([
      load('/audio/FX/FX1.mp3'),
      load('/audio/FX/STATICFX.mp3'),
    ]);

    console.log('[AudioPlayback] FX loaded:', {
      fxOpen: !!this.fxOpen,
      fxStatic: !!this.fxStatic,
    });
  }

  /**
   * Play a one-shot FX buffer directly to output (bypasses compressor for consistent level).
   */
  private playFXBuffer(buffer: AudioBuffer, atTime: number, gain: number = 0.4): void {
    if (!this.audioContext || !this.playbackGain) return;
    const g = this.audioContext.createGain();
    g.gain.value = gain;
    const src = this.audioContext.createBufferSource();
    src.buffer = buffer;
    src.connect(g);
    g.connect(this.playbackGain); // bypass radioBus/compressor → nivel siempre constante
    src.start(atTime);
  }

  /**
   * Start STATICFX looping through the radio chain (low gain, under the voice).
   */
  private startStatic(atTime: number): void {
    if (!this.audioContext || !this.radioBus || !this.fxStatic) return;
    this.stopStatic();

    this.staticGain = this.audioContext.createGain();
    this.staticGain.gain.value = 0;
    this.staticGain.gain.setValueAtTime(0, atTime);
    this.staticGain.gain.linearRampToValueAtTime(0.035, atTime + 0.05);

    this.staticSource = this.audioContext.createBufferSource();
    this.staticSource.buffer = this.fxStatic;
    this.staticSource.loop = true;
    this.staticSource.connect(this.staticGain);
    this.staticGain.connect(this.radioBus);
    this.staticSource.start(atTime);
  }

  /**
   * Fade out and stop the STATICFX loop.
   */
  private stopStatic(atTime?: number): void {
    if (!this.staticSource || !this.staticGain || !this.audioContext) return;
    const t = atTime ?? this.audioContext.currentTime;
    this.staticGain.gain.cancelScheduledValues(t);
    this.staticGain.gain.setValueAtTime(this.staticGain.gain.value, t);
    this.staticGain.gain.linearRampToValueAtTime(0, t + 0.08);
    const src = this.staticSource;
    setTimeout(() => { try { src.stop(); } catch { /* ignore */ } }, (t - this.audioContext.currentTime + 0.1) * 1000);
    this.staticSource = null;
    this.staticGain = null;
  }

  public playPcm16Chunk(pcm16Data: ArrayBuffer, sampleRate: number = 48000): void {
    if (!this.audioContext || !this.radioBus) {
      console.error('[AudioPlayback] Not initialized');
      return;
    }

    if (pcm16Data.byteLength % 2 !== 0) {
      console.warn(`[AudioPlayback] PCM16 byteLength is odd (${pcm16Data.byteLength}); truncating last byte`);
      pcm16Data = pcm16Data.slice(0, pcm16Data.byteLength - 1);
    }

    // Convert PCM16 to Float32
    const int16 = new Int16Array(pcm16Data);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768.0;
    }

    // Create AudioBuffer
    const audioBuffer = this.audioContext.createBuffer(1, float32.length, sampleRate);
    audioBuffer.getChannelData(0).set(float32);

    // Schedule for gapless playback
    const now = this.audioContext.currentTime;
    const isFirstChunk = this.nextStartTimeSec === 0;
    // On first chunk add 80ms bleep gap; subsequent chunks schedule normally
    const earliest = now + this.minLeadTimeSec + (isFirstChunk ? 0.08 : 0);
    const startTime = this.nextStartTimeSec > 0 ? Math.max(this.nextStartTimeSec, earliest) : earliest;

    if (isFirstChunk) {
      if (this.fxOpen) {
        this.playFXBuffer(this.fxOpen, now, 0.20);
      }
      this.startStatic(startTime);
    }

    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.radioBus);
    source.start(startTime);

    this.activeSources.add(source);
    this.isPlaying = true;
    this.nextStartTimeSec = startTime + audioBuffer.duration;

    source.onended = () => {
      this.activeSources.delete(source);
      if (this.activeSources.size === 0) {
        const endTime = this.audioContext!.currentTime;
        // Stop static then play FX1 close click
        this.stopStatic(endTime);
        if (this.fxOpen) {
          this.playFXBuffer(this.fxOpen, endTime + 0.20, 0.15);
        }
        this.isPlaying = false;
        this.nextStartTimeSec = 0;
        this.onPlaybackEndCallback?.();
      }
    };
  }

  public stop(): void {
    for (const source of this.activeSources) {
      try {
        source.onended = null;
        source.stop();
      } catch {
        // ignore
      }
    }
    this.activeSources.clear();
    this.stopStatic();
    this.nextStartTimeSec = 0;
    this.isPlaying = false;
  }

  public fadeOut(duration: number = 0.15): void {
    if (!this.playbackGain || !this.audioContext) return;

    const now = this.audioContext.currentTime;
    this.playbackGain.gain.cancelScheduledValues(now);
    this.playbackGain.gain.setValueAtTime(this.playbackGain.gain.value, now);
    this.playbackGain.gain.linearRampToValueAtTime(0, now + duration);

    setTimeout(() => {
      this.stop();
      if (this.playbackGain) {
        this.playbackGain.gain.value = 1.0;
      }
    }, duration * 1000);
  }

  public setVolume(volume: number): void {
    if (this.playbackGain) {
      this.playbackGain.gain.value = Math.max(0, Math.min(1, volume));
    }
  }

  public getVolume(): number {
    return this.playbackGain?.gain.value || 1.0;
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  public onPlaybackEnd(callback: () => void): void {
    this.onPlaybackEndCallback = callback;
  }

  public dispose(): void {
    this.stop();
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }
}
