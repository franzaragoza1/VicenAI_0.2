/**
 * Services Index
 * Export all services for easy importing
 */

// Gemini Live Service
export { GeminiLiveService } from './gemini-live';

// Telemetry Client Service
export { 
  TelemetryClient, 
  getTelemetryClient, 
  initTelemetryClient, 
  destroyTelemetryClient 
} from './telemetry-client';

export type { 
  TelemetryClientOptions, 
  TelemetryClientCallbacks 
} from './telemetry-client';

// Spotter Audio Service (MP3 pre-grabados)
export { SpotterAudioService, getSpotterService } from './elevenlabs-tts';

// Lap Comparison & API Services
export { lapComparison } from './lap-comparison';
export { lapApi } from './lap-api';
