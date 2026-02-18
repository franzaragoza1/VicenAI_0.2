/**
 * OutputSanitizer cleans and validates LLM output before sending to TTS
 */

/**
 * Sanitize LLM output text
 */
export function sanitizeOutput(text: string): string {
  let cleaned = text;

  // Remove control tags sometimes emitted by the LLM (handled separately as metadata)
  cleaned = cleaned.replace(/\[EMOTION:[^\]]+\]/gi, '');
  cleaned = cleaned.replace(/\[SPEED:[^\]]+\]/gi, '');

  // Remove markdown bold/italic
  cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1');  // **bold**
  cleaned = cleaned.replace(/\*([^*]+)\*/g, '$1');      // *italic*
  cleaned = cleaned.replace(/__([^_]+)__/g, '$1');      // __bold__
  cleaned = cleaned.replace(/_([^_]+)_/g, '$1');        // _italic_

  // Remove markdown headers
  cleaned = cleaned.replace(/^#+\s+/gm, '');

  // Remove markdown lists
  cleaned = cleaned.replace(/^[-*+]\s+/gm, '');
  cleaned = cleaned.replace(/^\d+\.\s+/gm, '');

  // Remove markdown code blocks
  cleaned = cleaned.replace(/```[\s\S]*?```/g, '');
  cleaned = cleaned.replace(/`([^`]+)`/g, '$1');

  // Remove markdown links (keep text, remove URL)
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // Remove forbidden phrases (preámbulos)
  const forbiddenPhrases = [
    /let me (check|see|review|analyze)/gi,
    /voy a (revisar|comprobar|ver|analizar)/gi,
    /déjame (ver|revisar|comprobar|analizar)/gi,
    /permíteme (ver|revisar|comprobar|analizar)/gi,
    /beginning the /gi,
    /starting the /gi,
    /analyzing /gi,
    /analizando /gi,
  ];

  for (const pattern of forbiddenPhrases) {
    cleaned = cleaned.replace(pattern, '');
  }

  // Convert fancy quotes to standard quotes
  cleaned = cleaned.replace(/[""]/g, '"');
  cleaned = cleaned.replace(/['']/g, "'");

  // Normalize whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  // Ensure proper sentence ending
  if (cleaned.length > 0 && !/[.!?]$/.test(cleaned)) {
    cleaned += '.';
  }

  return cleaned;
}

/**
 * Detect if text is likely English (for retry logic)
 */
export function isLikelyEnglish(text: string): boolean {
  // Common English words that don't appear in Spanish
  const englishIndicators = [
    'the', 'and', 'is', 'you', 'your', 'are', 'have', 'has',
    'this', 'that', 'with', 'for', 'from', 'what', 'which',
    'race', 'lap', 'gap', 'tire', 'fuel', 'position',
  ];

  const words = text.toLowerCase().split(/\s+/);
  const englishMatches = words.filter(w => englishIndicators.includes(w)).length;

  // If more than 30% of words are common English words, likely English
  return (englishMatches / words.length) > 0.3;
}

/**
 * Enforce maximum sentence count (1-3 frases)
 */
export function enforceSentenceLimit(text: string, maxSentences: number = 3): string {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [];

  if (sentences.length <= maxSentences) {
    return text;
  }

  // Return first maxSentences sentences
  return sentences.slice(0, maxSentences).join(' ').trim();
}

/**
 * Complete sanitization pipeline
 */
export function sanitizeForTTS(text: string): { cleaned: string; isEnglish: boolean } {
  // Clean output
  let cleaned = sanitizeOutput(text);

  // Optional: enforce sentence limit (prefer guiding the LLM via prompt; keep this as a safety valve)
  const maxSentencesFromEnv = process.env.VOICE_TTS_MAX_SENTENCES;
  const maxSentences = maxSentencesFromEnv ? Number.parseInt(maxSentencesFromEnv, 10) : NaN;
  if (Number.isFinite(maxSentences) && maxSentences > 0) {
    cleaned = enforceSentenceLimit(cleaned, maxSentences);
  }

  // Detect language
  const isEnglish = isLikelyEnglish(cleaned);

  return { cleaned, isEnglish };
}
