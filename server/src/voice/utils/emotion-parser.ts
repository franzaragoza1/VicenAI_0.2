/**
 * Emotion and speed parser for TTS
 */

export type Emotion = 'neutral' | 'calm' | 'content' | 'excited' | 'scared' | 'angry' | 'sad';

export interface TTSMetadata {
  text: string;
  emotion: Emotion;
  speed: number;
}

/**
 * Parse emotion and speed tags from LLM output
 * Format: [EMOTION:excited][SPEED:1.2]Text content here
 */
export function parseEmotionTags(input: string): TTSMetadata {
  let text = input;
  let emotion: Emotion = 'neutral';
  let speed: number = 1.0;

  // Extract emotion tag
  const emotionMatch = text.match(/\[EMOTION:(neutral|calm|content|excited|scared|angry|sad)\]/i);
  if (emotionMatch) {
    emotion = emotionMatch[1].toLowerCase() as Emotion;
    text = text.replace(emotionMatch[0], '');
  }

  // Extract speed tag (allow spaces in number)
  const speedMatch = text.match(/\[SPEED:([\d.\s]+)\]/i);
  if (speedMatch) {
    const parsedSpeed = parseFloat(speedMatch[1].replace(/\s/g, '')); // Remove spaces before parsing
    // Clamp speed between 0.7 and 1.5
    speed = Math.max(0.7, Math.min(1.5, parsedSpeed));
    text = text.replace(speedMatch[0], '');
  }

  // Clean up any remaining whitespace
  text = text.trim();

  return { text, emotion, speed };
}
