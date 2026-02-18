/**
 * Quick test script for Eleven Labs TTS connection
 *
 * Usage: node server/test-elevenlabs.js
 */

import { ElevenLabsTTSService } from './src/voice/providers/elevenlabs-tts.js';
import { loadEnvOnce } from './src/load-env.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

loadEnvOnce({ cwd: repoRoot, overrideProcessEnv: true });

console.log('=== Eleven Labs TTS Connection Test ===\n');

// Check API key
const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error('❌ ELEVENLABS_API_KEY not set in .env');
  process.exit(1);
}

console.log('✅ API Key found:', apiKey.substring(0, 8) + '...');

// Create service
const tts = new ElevenLabsTTSService({
  apiKey,
  modelId: process.env.ELEVENLABS_MODEL_ID || 'eleven_turbo_v2_5',
  voiceId: process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB',
  language: 'es',
  sampleRate: 48000,
  encoding: 'pcm_16000',
});

// Setup event listeners
tts.on('connected', () => {
  console.log('\n✅ Connected successfully!');
  console.log('Sending test message...\n');

  // Send test message
  tts.synthesize({
    text: 'Hola, esto es una prueba de Eleven Labs.',
  });
});

tts.on('audioChunk', (buffer) => {
  console.log(`📊 Audio chunk: ${buffer.length} bytes`);
});

tts.on('chunkDone', () => {
  console.log('✅ Chunk completed');
});

tts.on('completed', () => {
  console.log('\n✅ Synthesis completed successfully!');
  console.log('Disconnecting...');
  tts.disconnect();
  setTimeout(() => process.exit(0), 500);
});

tts.on('error', (error) => {
  console.error('\n❌ Error:', error.message);
  console.error('Full error:', error);
  process.exit(1);
});

tts.on('disconnected', () => {
  console.log('👋 Disconnected');
});

// Connect
console.log('\nConnecting to Eleven Labs...\n');
tts.connect().catch((error) => {
  console.error('❌ Connection failed:', error.message);
  console.error('Full error:', error);
  process.exit(1);
});

// Timeout after 30 seconds
setTimeout(() => {
  console.error('\n⏱️ Timeout after 30 seconds');
  process.exit(1);
}, 30000);
