/**
 * TextChunker segments LLM output stream into TTS-friendly sentence chunks
 */
export class TextChunker {
  private buffer: string = '';
  private maxChunkSize: number;
  private minChunkSize: number;

  constructor(maxChunkSize: number = 220, minChunkSize: number = 30) {
    this.maxChunkSize = maxChunkSize;
    this.minChunkSize = minChunkSize;
  }

  /**
   * Push new text delta from LLM
   * Returns array of complete sentence chunks ready for TTS
   */
  public push(textDelta: string): string[] {
    this.buffer += textDelta;
    const chunks: string[] = [];

    // Find sentence boundaries: . ! ? \n
    const sentenceRegex = /([^.!?\n]+[.!?\n]+)/g;
    let match;
    let lastIndex = 0;

    while ((match = sentenceRegex.exec(this.buffer)) !== null) {
      const sentence = match[1].trim();
      lastIndex = sentenceRegex.lastIndex;

      if (sentence.length === 0) {
        continue;
      }

      // If sentence is too long, split by commas or semicolons
      if (sentence.length > this.maxChunkSize) {
        chunks.push(...this.splitLongSentence(sentence));
      } else if (sentence.length >= this.minChunkSize) {
        chunks.push(sentence);
      } else {
        // Sentence too short, keep in buffer (might be incomplete)
        lastIndex = match.index;
        break;
      }
    }

    // Update buffer (keep unprocessed text)
    this.buffer = this.buffer.slice(lastIndex).trim();

    return chunks;
  }

  /**
   * Flush remaining buffer (at end of LLM stream)
   */
  public flush(): string[] {
    const chunks: string[] = [];

    if (this.buffer.trim().length > 0) {
      // If buffer is too long, split it
      if (this.buffer.length > this.maxChunkSize) {
        chunks.push(...this.splitLongSentence(this.buffer));
      } else {
        chunks.push(this.buffer.trim());
      }

      this.buffer = '';
    }

    return chunks;
  }

  /**
   * Split long sentence by commas or semicolons
   */
  private splitLongSentence(sentence: string): string[] {
    const chunks: string[] = [];
    const parts = sentence.split(/([,;])/);  // Keep delimiters

    let currentChunk = '';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];

      if (part === ',' || part === ';') {
        // Add delimiter to current chunk
        currentChunk += part;

        // If chunk is long enough, emit it
        if (currentChunk.length >= this.minChunkSize) {
          chunks.push(currentChunk.trim());
          currentChunk = '';
        }
      } else {
        currentChunk += part;

        // Hard limit: force split if too long
        if (currentChunk.length > this.maxChunkSize) {
          // Find last space to avoid cutting words
          const lastSpace = currentChunk.lastIndexOf(' ', this.maxChunkSize);

          if (lastSpace > this.minChunkSize) {
            chunks.push(currentChunk.slice(0, lastSpace).trim());
            currentChunk = currentChunk.slice(lastSpace).trim();
          } else {
            // No good split point, just cut at max
            chunks.push(currentChunk.slice(0, this.maxChunkSize).trim());
            currentChunk = currentChunk.slice(this.maxChunkSize).trim();
          }
        }
      }
    }

    // Add remaining chunk
    if (currentChunk.trim().length > 0) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  /**
   * Reset chunker state
   */
  public reset(): void {
    this.buffer = '';
  }

  /**
   * Get current buffer (for debugging)
   */
  public getBuffer(): string {
    return this.buffer;
  }
}
