/**
 * AudioWorklet Processor for microphone capture
 * Sends audio buffers to main thread for processing
 */

class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];

    if (input && input.length > 0) {
      const channelData = input[0]; // Mono (first channel)

      // Send buffer to main thread
      this.port.postMessage({
        buffer: channelData
      });
    }

    // Keep processor alive
    return true;
  }
}

registerProcessor('audio-processor', AudioProcessor);
