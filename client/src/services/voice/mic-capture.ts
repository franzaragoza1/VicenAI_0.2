/**
 * MicCaptureService handles microphone input with VAD and downsampling
 * Reuses AudioWorklet from existing GeminiLiveService
 */

export class MicCaptureService {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private isCapturing: boolean = false;

  // VAD (Voice Activity Detection) parameters
  private vadThreshold: number = -40; // dB threshold for voice detection
  private vadActive: boolean = false;

  // Debug
  private hasLoggedFirstBuffer: boolean = false;

  // Callbacks
  private onAudioChunkCallback: ((chunk: ArrayBuffer) => void) | null = null;
  private onVadChangeCallback: ((active: boolean) => void) | null = null;

  /**
   * Initialize audio capture
   */
  public async initialize(): Promise<void> {
    if (this.audioContext) {
      console.log('[MicCapture] Already initialized');
      return;
    }

    try {
      // Create AudioContext
      this.audioContext = new AudioContext();
      console.log(`[MicCapture] AudioContext created (sample rate: ${this.audioContext.sampleRate}Hz)`);

      // Request microphone access
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: { ideal: 48000 },
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      console.log('[MicCapture] Microphone access granted');

      // Create source node
      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);

      // Try to use AudioWorklet (preferred) or fallback to ScriptProcessor
      await this.setupAudioProcessing();

      console.log('[MicCapture] Initialized successfully');

    } catch (error) {
      console.error('[MicCapture] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Setup audio processing (AudioWorklet or ScriptProcessor fallback)
   */
  private async setupAudioProcessing(): Promise<void> {
    try {
      // Try AudioWorklet first (modern, efficient)
      // Use absolute URL to ensure it works in both dev and production
      const workletUrl = new URL('/audio-processor.js', window.location.origin).href;
      console.log('[MicCapture] Loading AudioWorklet from:', workletUrl);
      await this.audioContext!.audioWorklet.addModule(workletUrl);

      this.workletNode = new AudioWorkletNode(this.audioContext!, 'audio-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
      });

      // Handle messages from worklet
      this.workletNode.port.onmessage = (event) => {
        if (this.isCapturing && event.data.buffer) {
          this.processAudioBuffer(event.data.buffer as Float32Array);
        }
      };

      this.sourceNode!.connect(this.workletNode);

      console.log('[MicCapture] Using AudioWorklet (preferred)');

    } catch (error) {
      console.warn('[MicCapture] AudioWorklet failed, falling back to ScriptProcessor:', error);

      // Fallback to ScriptProcessor
      this.scriptProcessor = this.audioContext!.createScriptProcessor(4096, 1, 1);

      this.scriptProcessor.onaudioprocess = (e) => {
        if (this.isCapturing) {
          const inputData = e.inputBuffer.getChannelData(0);
          this.processAudioBuffer(inputData);
        }
      };

      this.sourceNode!.connect(this.scriptProcessor);
      this.scriptProcessor.connect(this.audioContext!.destination);

      console.log('[MicCapture] Using ScriptProcessor (fallback)');
    }
  }

  /**
   * Process audio buffer: downsample, encode, VAD, and emit
   */
  private processAudioBuffer(inputData: Float32Array): void {
    // Debug: Log first call
    if (!this.hasLoggedFirstBuffer) {
      console.log('[MicCapture] First audio buffer received, length:', inputData.length);
      this.hasLoggedFirstBuffer = true;
    }

    // VAD: Check voice activity
    const rms = this.calculateRMS(inputData);
    const db = 20 * Math.log10(rms);
    const vadActive = db > this.vadThreshold;

    if (vadActive !== this.vadActive) {
      this.vadActive = vadActive;
      if (this.onVadChangeCallback) {
        this.onVadChangeCallback(vadActive);
      }
    }

    // Downsample to 16kHz
    const downsampledData = this.downsampleBuffer(
      inputData,
      this.audioContext!.sampleRate,
      16000
    );

    // Convert to PCM16
    const pcmData = this.floatTo16BitPCM(downsampledData);

    // Emit audio chunk
    if (this.onAudioChunkCallback) {
      this.onAudioChunkCallback(pcmData);
    }
  }

  /**
   * Calculate RMS (Root Mean Square) for VAD
   */
  private calculateRMS(buffer: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
      sum += buffer[i] * buffer[i];
    }
    return Math.sqrt(sum / buffer.length);
  }

  /**
   * Downsample audio buffer with anti-aliasing
   * (Copied from GeminiLiveService)
   */
  private downsampleBuffer(
    buffer: Float32Array,
    inputRate: number,
    outputRate: number
  ): Float32Array {
    if (outputRate === inputRate) {
      return buffer;
    }

    const sampleRateRatio = inputRate / outputRate;
    const outputLength = Math.round(buffer.length / sampleRateRatio);
    const result = new Float32Array(outputLength);

    // Simple low-pass filter coefficients (3-tap FIR)
    const filterCoeffs = [0.25, 0.5, 0.25];
    const filtered = new Float32Array(buffer.length);

    // Apply filter
    for (let i = 0; i < buffer.length; i++) {
      let sum = 0;
      for (let j = 0; j < filterCoeffs.length; j++) {
        const sampleIndex = i - j + Math.floor(filterCoeffs.length / 2);
        if (sampleIndex >= 0 && sampleIndex < buffer.length) {
          sum += buffer[sampleIndex] * filterCoeffs[j];
        }
      }
      filtered[i] = sum;
    }

    // Downsample
    for (let i = 0; i < outputLength; i++) {
      const srcIndex = Math.round(i * sampleRateRatio);
      if (srcIndex < filtered.length) {
        result[i] = filtered[srcIndex];
      } else {
        result[i] = 0;
      }
    }

    return result;
  }

  /**
   * Convert Float32 to 16-bit PCM
   * (Copied from GeminiLiveService)
   */
  private floatTo16BitPCM(input: Float32Array): ArrayBuffer {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return output.buffer;
  }

  /**
   * Set audio chunk callback
   */
  public onAudioChunk(callback: (chunk: ArrayBuffer) => void): void {
    this.onAudioChunkCallback = callback;
  }

  /**
   * Set VAD change callback
   */
  public onVadChange(callback: (active: boolean) => void): void {
    this.onVadChangeCallback = callback;
  }

  /**
   * Start capturing audio
   */
  public async startCapture(): Promise<void> {
    if (!this.audioContext) {
      console.error('[MicCapture] Not initialized');
      return;
    }

    // Resume AudioContext if suspended (required for Chrome autoplay policy)
    if (this.audioContext.state === 'suspended') {
      console.log('[MicCapture] Resuming suspended AudioContext...');
      await this.audioContext.resume();
    }

    this.isCapturing = true;
    console.log('[MicCapture] Capture started (AudioContext state:', this.audioContext.state + ')');
  }

  /**
   * Stop capturing audio
   */
  public stopCapture(): void {
    this.isCapturing = false;
    this.vadActive = false;
    console.log('[MicCapture] Capture stopped');
  }

  /**
   * Cleanup and release resources
   */
  public dispose(): void {
    this.stopCapture();

    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }

    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    console.log('[MicCapture] Disposed');
  }

  /**
   * Get VAD threshold
   */
  public getVadThreshold(): number {
    return this.vadThreshold;
  }

  /**
   * Set VAD threshold
   */
  public setVadThreshold(threshold: number): void {
    this.vadThreshold = threshold;
  }

  /**
   * Check if VAD is active
   */
  public isVadActive(): boolean {
    return this.vadActive;
  }
}
