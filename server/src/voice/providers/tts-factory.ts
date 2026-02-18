import { TTSProvider, TTSProviderConfig } from './tts-provider.js';
import { CartesiaTTSService } from './cartesia-tts.js';
import { ElevenLabsTTSService } from './elevenlabs-tts.js';

/**
 * TTS provider types
 */
export type TTSProviderType = 'cartesia' | 'elevenlabs';

/**
 * Create TTS provider based on environment configuration
 *
 * Environment variables:
 * - TTS_PROVIDER: 'cartesia' | 'elevenlabs' (default: cartesia)
 *
 * Cartesia-specific:
 * - CARTESIA_API_KEY (required)
 * - CARTESIA_MODEL_ID (optional, default: sonic-3-turbo)
 * - CARTESIA_VOICE_ID (optional, default: Spanish male voice)
 *
 * Eleven Labs-specific:
 * - ELEVENLABS_API_KEY (required)
 * - ELEVENLABS_MODEL_ID (optional, default: eleven_turbo_v2_5)
 * - ELEVENLABS_VOICE_ID (optional, default: Adam)
 */
export function createTTSProvider(): TTSProvider {
  const provider = (process.env.TTS_PROVIDER || 'cartesia').toLowerCase() as TTSProviderType;

  console.log(`[TTSFactory] Creating TTS provider: ${provider}`);

  switch (provider) {
    case 'elevenlabs':
      return createElevenLabsProvider();

    case 'cartesia':
    default:
      return createCartesiaProvider();
  }
}

/**
 * Create Cartesia TTS provider
 */
function createCartesiaProvider(): TTSProvider {
  const apiKey = process.env.CARTESIA_API_KEY;
  if (!apiKey) {
    throw new Error('CARTESIA_API_KEY not set in environment');
  }

  const config: TTSProviderConfig = {
    apiKey,
    modelId: process.env.CARTESIA_MODEL_ID || 'sonic-3-turbo',
    voiceId: process.env.CARTESIA_VOICE_ID || 'a0e99841-438c-4a64-b679-ae501e7d6091',
    language: 'es',
    sampleRate: 48000,
    encoding: 'pcm_s16le',
  };

  return new CartesiaTTSService(config);
}

/**
 * Create Eleven Labs TTS provider
 */
function createElevenLabsProvider(): TTSProvider {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error('ELEVENLABS_API_KEY not set in environment');
  }

  const config: any = {
    apiKey,
    modelId: process.env.ELEVENLABS_MODEL_ID || 'eleven_turbo_v2_5',
    voiceId: process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB',  // Adam
    language: 'es',
    // Output format. Try pcm_16000 first (lowest PCM tier, may work on Starter plan).
    // If you get output_format_not_allowed, your plan only supports MP3:
    //   set ELEVENLABS_OUTPUT_FORMAT=mp3_44100_128 and upgrade the client to decode MP3.
    // PCM formats: pcm_16000, pcm_22050, pcm_24000, pcm_44100
    encoding: process.env.ELEVENLABS_OUTPUT_FORMAT || 'pcm_16000',
  };

  // Optional voice settings
  if (process.env.ELEVENLABS_STABILITY) {
    config.stability = parseFloat(process.env.ELEVENLABS_STABILITY);
  }
  if (process.env.ELEVENLABS_SIMILARITY_BOOST) {
    config.similarityBoost = parseFloat(process.env.ELEVENLABS_SIMILARITY_BOOST);
  }

  return new ElevenLabsTTSService(config);
}

/**
 * Get available TTS providers based on environment
 */
export function getAvailableTTSProviders(): TTSProviderType[] {
  const providers: TTSProviderType[] = [];

  if (process.env.CARTESIA_API_KEY) {
    providers.push('cartesia');
  }

  if (process.env.ELEVENLABS_API_KEY) {
    providers.push('elevenlabs');
  }

  return providers;
}
