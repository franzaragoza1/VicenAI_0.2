import express, { Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';
import { fileURLToPath } from 'url';
import { pttKeyboardService, KEY_CODES } from './ptt-keyboard.js';
import { lapStorage, LapData, TelemetryPoint } from './lap-storage.js';
import { VertexLiveBridge } from './vertex-live-bridge.js';
import { loadEnvOnce } from './load-env.js';
import { VoiceSessionManager } from './voice/voice-ws.js';
import { DeepgramSTTService } from './voice/providers/deepgram-stt.js';
import { RaceStateModule } from './voice/context/race-state.js';
import { OpenRouterLLMService, ToolCall } from './voice/providers/openrouter-llm.js';
import { PythonCommandExecutor } from './python-commands.js';
import { createTTSProvider } from './voice/providers/tts-factory.js';
import { sanitizeForTTS } from './voice/utils/output-sanitizer.js';
import { parseEmotionTags } from './voice/utils/emotion-parser.js';
import { ToolHandlers } from './voice/tools/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
loadEnvOnce({ cwd: repoRoot, overrideProcessEnv: true });

interface TelemetryFrame {
  [key: string]: unknown;
}

const PORT = 8081;
const IRACING_TELEMETRY_WS_PORT = 8766;  // Port where Python telemetry service runs

let lastSetupData: any = null;
let lastIRacingTelemetry: any = null;  // Cache for iRacing native telemetry
let lastSimHubTelemetry: any = null;   // Cache for SimHub telemetry (if available)
let pythonTelemetryWs: WebSocket | null = null;  // Reference to Python WebSocket for sending commands

// Gemini Live state tracking (for MCP bridge)
let lastGeminiState = {
  connected: false,
  speaking: false,
  lastTranscript: null as string | null,
  lastUpdate: Date.now(),
};

// Pending command responses (for async command handling)
const pendingCommands = new Map<string, { ws: WebSocket; resolve: (data: any) => void }>();

/**
 * Helper to get latest telemetry data (for voice pipeline race-state module)
 */
export function getLatestTelemetryData(): any | null {
  return lastIRacingTelemetry;
}

const app = express();
const httpServer = createServer(app);

// CORS middleware - allow frontend to access API
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (_req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
});

// Use noServer mode to handle multiple WebSocket paths properly
const wss = new WebSocketServer({ noServer: true });
const telemetryWss = new WebSocketServer({ noServer: true });
const geminiWss = new WebSocketServer({ noServer: true });
const voiceWss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
const telemetryClients = new Set<WebSocket>();

new VertexLiveBridge(geminiWss);

// Voice pipeline session manager
const voiceSessionManager = new VoiceSessionManager();

// Race state module (shared across all voice sessions)
const raceStateModule = new RaceStateModule();

// Python command executor (for tool calling)
const pythonCommandExecutor = new PythonCommandExecutor(pythonTelemetryWs);

// Handle upgrade manually to route to correct WebSocket server
httpServer.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url || '/', `http://${request.headers.host}`).pathname;

  if (pathname === '/telemetry') {
    telemetryWss.handleUpgrade(request, socket, head, (ws) => {
      telemetryWss.emit('connection', ws, request);
    });
  } else if (pathname === '/gemini') {
    geminiWss.handleUpgrade(request, socket, head, (ws) => {
      geminiWss.emit('connection', ws, request);
    });
  } else if (pathname === '/voice') {
    voiceWss.handleUpgrade(request, socket, head, (ws) => {
      voiceWss.emit('connection', ws, request);
    });
  } else if (pathname === '/' || pathname === '') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// Track connected clients with their ready state
interface ClientInfo {
  ws: WebSocket;
  isReady: boolean;
}
const connectedClients = new Map<WebSocket, ClientInfo>();

// Voice WebSocket connection handler
voiceWss.on('connection', (ws: WebSocket) => {
  const session = voiceSessionManager.createSession(ws);

  // Create Deepgram STT service for this session
  const deepgramApiKey = process.env.DEEPGRAM_API_KEY;
  if (!deepgramApiKey) {
    console.error('[Voice] DEEPGRAM_API_KEY not set in environment');
    session.sendError('stt', 'STT service not configured', false);
    session.close();
    return;
  }

  const deepgram = new DeepgramSTTService({
    apiKey: deepgramApiKey,
    model: process.env.DEEPGRAM_MODEL || 'nova-2',
    language: 'es',
    sampleRate: 16000,
    channels: 1,
    encoding: 'linear16',
    punctuate: true,
    interimResults: true,
    endpointing: 300,
    smartFormat: true,
    vadEvents: true,
  });

  // Connect to Deepgram
  deepgram.connect().catch((error) => {
    console.error('[Voice] Failed to connect to Deepgram:', error);
    session.sendError('stt', 'Failed to connect to speech recognition service', true);
  });

  // Create OpenRouter LLM service for this session
  const openrouterApiKey = process.env.OPENROUTER_API_KEY;
  if (!openrouterApiKey) {
    console.error('[Voice] OPENROUTER_API_KEY not set in environment');
    session.sendError('llm', 'LLM service not configured', false);
    session.close();
    return;
  }

  // Parse preferred providers from environment variable
  // Format: "Together,Fireworks,Groq" or "Friendli,DeepInfra"
  const preferredProviders = process.env.OPENROUTER_PROVIDERS
    ? process.env.OPENROUTER_PROVIDERS.split(',').map(p => p.trim()).filter(p => p.length > 0)
    : [];

  const llm = new OpenRouterLLMService(
    {
      apiKey: openrouterApiKey,
      model: process.env.OPENROUTER_MODEL || 'qwen/qwen3-235b-a22b-2507:nitro',
      fallbackModel: process.env.OPENROUTER_FALLBACK_MODEL || 'openai/gpt-4o-mini',
      maxTokens: 250,
      temperature: 0.7,
      preferredProviders,
    },
    {
      simulator: lastIRacingTelemetry?.simulator || 'iRacing',
      sessionType: lastIRacingTelemetry?.session?.type || 'race',
    }
  );

  // Create tool handlers for LLM function calling
  const toolHandlers = new ToolHandlers(pythonCommandExecutor);

  // Create TTS service using factory (supports Cartesia, Eleven Labs, etc.)
  let tts;
  try {
    tts = createTTSProvider();
  } catch (error: any) {
    console.error('[Voice] Failed to create TTS provider:', error.message);
    session.sendError('tts', `TTS service not configured: ${error.message}`, false);
    session.close();
    return;
  }

  // Connect to TTS service
  tts.connect().catch((error: Error) => {
    console.error('[Voice] Failed to connect to TTS service:', error);
    session.sendError('tts', 'Failed to connect to text-to-speech service', true);
  });

  // Accumulate full LLM response before sending to TTS (eliminates chunking delays)
  let fullLLMResponse: string = '';

  // Track emotion/speed for current LLM response
  let currentEmotion: 'neutral' | 'calm' | 'content' | 'excited' | 'scared' | 'angry' | 'sad' = 'neutral';
  let currentSpeed: number = 1.0;
  let emotionParsed: boolean = false;

  // Start race state module (detect session type from telemetry)
  const sessionType = lastIRacingTelemetry?.session?.type || 'race';
  if (!raceStateModule.listenerCount('proactiveTrigger')) {
    // Only start once (shared across sessions)
    raceStateModule.start(sessionType);
  }

  // TTS event handlers
  tts.on('connected', () => {
    // intentionally quiet
  });

  tts.on('disconnected', () => {
    // intentionally quiet
  });

  // Stream TTS audio to client; keep an accumulator for stats/logging
  let audioAccumulator: Buffer[] = [];
  let audioChunkIndex = 0;
  let cartesiaChunkIndex = 0;
  let ttsUtteranceId = 0;
  let ttsActiveUtteranceId = 0;
  let ttsSentChunks = 0;
  let ttsSentBytes = 0;
  const shouldSaveTtsChunks =
    process.env.VOICE_DEBUG_SAVE_TTS_CHUNKS === '1' ||
    process.env.VOICE_DEBUG_SAVE_CARTESIA_CHUNKS === '1';
  const ttsSampleRate = 48000;
  const ttsBytesPerSample = 2; // 16-bit mono PCM
  if (shouldSaveTtsChunks) {
    console.log(`[Voice] TTS debug WAV chunks enabled -> ${path.join(__dirname, '..', 'audio_debug')}`);
  }

  tts.on('audioChunk', (pcmBuffer: Buffer) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const chunkIndex = cartesiaChunkIndex++;
    const filename = `cartesia_${timestamp}_${session.getSessionId()}_chunk${chunkIndex}.wav`;

    ttsSentChunks++;
    ttsSentBytes += pcmBuffer.length;

    let saved = false;
    if (shouldSaveTtsChunks) {
      // Save each individual Cartesia chunk for debugging as WAV (async; avoid blocking the event loop)
      const audioDir = path.join(__dirname, '..', 'audio_debug');
      if (!fs.existsSync(audioDir)) {
        fs.mkdirSync(audioDir, { recursive: true });
      }

      const createWavHeader = (dataSize: number): Buffer => {
        const header = Buffer.alloc(44);
        header.write('RIFF', 0);
        header.writeUInt32LE(36 + dataSize, 4);
        header.write('WAVE', 8);
        header.write('fmt ', 12);
        header.writeUInt32LE(16, 16); // fmt chunk size
        header.writeUInt16LE(1, 20); // PCM format
        header.writeUInt16LE(1, 22); // mono
        header.writeUInt32LE(ttsSampleRate, 24); // sample rate
        header.writeUInt32LE(ttsSampleRate * ttsBytesPerSample, 28); // byte rate
        header.writeUInt16LE(ttsBytesPerSample, 32); // block align
        header.writeUInt16LE(16, 34); // bits per sample
        header.write('data', 36);
        header.writeUInt32LE(dataSize, 40);
        return header;
      };

      const wavHeader = createWavHeader(pcmBuffer.length);
      const wavFile = Buffer.concat([wavHeader, pcmBuffer]);
      saved = true;
      void fs.promises.writeFile(path.join(audioDir, filename), wavFile).catch((err) => {
        console.warn('[Voice] Failed to write debug WAV chunk:', err);
      });
    }

    // Per-chunk logging removed to avoid terminal spam.

    audioAccumulator.push(pcmBuffer);

    // Stream raw PCM16 to the client as it arrives (avoids large single WS payloads)
    session.sendBinaryAudio(pcmBuffer);
  });

  tts.on('chunkDone', () => {
    if (audioAccumulator.length > 0) {
      const fullBuffer = Buffer.concat(audioAccumulator);
      const durationSec = fullBuffer.length / (ttsSampleRate * ttsBytesPerSample);
      console.log(`[Voice] TTS done (${fullBuffer.length} bytes, ${durationSec.toFixed(2)}s)`);

      if (ttsActiveUtteranceId !== 0) {
        session.sendJSON({
          type: 'tts_audio_done',
          utteranceId: ttsActiveUtteranceId,
          chunks: ttsSentChunks,
          bytes: ttsSentBytes,
          durationMs: Math.round((ttsSentBytes / (ttsSampleRate * ttsBytesPerSample)) * 1000),
        });
      }

      audioAccumulator = [];
      cartesiaChunkIndex = 0; // Reset for next synthesis
      ttsActiveUtteranceId = 0;
      ttsSentChunks = 0;
      ttsSentBytes = 0;
    } else {
      console.warn(`[Voice] TTS chunk done but audioAccumulator is empty!`);
    }
  });

  tts.on('completed', () => {
    // intentionally quiet
    session.setTTSActive(false);
    raceStateModule.setTTSStreaming(false);
  });

  tts.on('cancelled', () => {
    audioAccumulator = [];
    console.warn(`[Voice] TTS cancelled for session ${session.getSessionId()}`);

    if (ttsActiveUtteranceId !== 0) {
      session.sendJSON({
        type: 'tts_audio_done',
        utteranceId: ttsActiveUtteranceId,
        chunks: ttsSentChunks,
        bytes: ttsSentBytes,
        durationMs: Math.round((ttsSentBytes / (ttsSampleRate * ttsBytesPerSample)) * 1000),
      });
    }
    ttsActiveUtteranceId = 0;
    ttsSentChunks = 0;
    ttsSentBytes = 0;
    session.setTTSActive(false);
    raceStateModule.setTTSStreaming(false);
  });

  tts.on('error', (error: Error) => {
    console.error(`[Voice] TTS error:`, error);
    session.sendError('tts', error.message, true);

    if (ttsActiveUtteranceId !== 0) {
      session.sendJSON({
        type: 'tts_audio_done',
        utteranceId: ttsActiveUtteranceId,
        chunks: ttsSentChunks,
        bytes: ttsSentBytes,
        durationMs: Math.round((ttsSentBytes / (ttsSampleRate * ttsBytesPerSample)) * 1000),
      });
    }
    ttsActiveUtteranceId = 0;
    ttsSentChunks = 0;
    ttsSentBytes = 0;
    session.setTTSActive(false);
    raceStateModule.setTTSStreaming(false);
  });

  // LLM event handlers
  llm.on('delta', (text: string) => {
    // Parse emotion tags from first delta only
    let processedText = text;
    if (!emotionParsed) {
      const { text: cleanText, emotion, speed } = parseEmotionTags(text);
      currentEmotion = emotion;
      currentSpeed = speed;
      emotionParsed = true;
      processedText = cleanText;

      // metadata parsed silently
    }

    session.sendLLMDelta(processedText);

    // Accumulate text instead of chunking
    fullLLMResponse += processedText;
  });

  llm.on('done', (text: string, duration: number) => {
    session.sendLLMDone(text, duration);
    session.setLLMActive(false);

    // Check if LLM decided to stay silent (for periodic contexts)
    if (fullLLMResponse.trim().toUpperCase().includes('[SILENT]')) {
      console.log('[Voice] 🔇 LLM decided to stay silent (nothing important to say)');
      fullLLMResponse = '';
      return;
    }

    // Send full accumulated response to TTS in one shot (no chunking delays)
    if (fullLLMResponse.trim().length > 0) {
      // Re-parse metadata at the end (tags can arrive split across deltas)
      const parsed = parseEmotionTags(fullLLMResponse);
      currentEmotion = parsed.emotion;
      currentSpeed = parsed.speed;

      const { cleaned, isEnglish } = sanitizeForTTS(parsed.text);

      if (isEnglish) {
        console.warn(`[Voice] Detected English output`);
      }

      if (cleaned.length > 0) {
        // intentionally quiet
        session.setTTSActive(true);
        raceStateModule.setTTSStreaming(true);

        ttsActiveUtteranceId = ++ttsUtteranceId;
        session.sendJSON({
          type: 'tts_audio_start',
          utteranceId: ttsActiveUtteranceId,
          sampleRate: tts.getSampleRate(),
          encoding: 'pcm_s16le',
          channels: 1,
        });

        tts.synthesize({
          text: cleaned,
          emotion: currentEmotion,
          speed: currentSpeed,
        });
      }
    }

    // Reset for next response
    fullLLMResponse = '';
    currentEmotion = 'neutral';
    currentSpeed = 1.0;
    emotionParsed = false;
  });

  llm.on('functionCall', async (toolCall: ToolCall) => {
    console.log(`[Voice] Function call: ${toolCall.name}`, toolCall.arguments);

    try {
      let result: any;

      // Execute tool
      switch (toolCall.name) {
        // === ACTION TOOLS ===
        case 'configure_pit_stop':
          result = await pythonCommandExecutor.configurePitStop(toolCall.arguments);
          break;
        case 'get_pit_status':
          result = await pythonCommandExecutor.getPitStatus();
          break;
        case 'send_chat_macro':
          result = await pythonCommandExecutor.sendChatMacro(toolCall.arguments.macroNumber);
          break;
        case 'request_current_setup':
          result = await pythonCommandExecutor.requestCurrentSetup();
          break;

        // === READ TOOLS ===
        case 'get_session_context':
          result = await toolHandlers.getSessionContext();
          break;
        case 'get_vehicle_setup':
          result = await toolHandlers.getVehicleSetup();
          break;
        case 'get_recent_events':
          result = await toolHandlers.getRecentEvents(toolCall.arguments.limit);
          break;
        case 'compare_laps':
          result = await toolHandlers.compareLaps(toolCall.arguments.lap1, toolCall.arguments.lap2);
          break;

        default:
          result = { error: `Unknown tool: ${toolCall.name}` };
      }

      // Add function result to LLM conversation
      llm.addFunctionResult(toolCall.name, result);

      // Continue LLM stream with function result (will confirm action in voice)
      const raceState = raceStateModule.getStateForLLM();
      await llm.sendMessage('', raceState, false);

    } catch (error: any) {
      console.error(`[Voice] Tool execution error:`, error);
      llm.addFunctionResult(toolCall.name, { error: error.message });
      session.sendError('llm', `Tool execution failed: ${error.message}`, true);
    }
  });

  llm.on('aborted', () => {
    // intentionally quiet
    session.setLLMActive(false);
  });

  llm.on('error', (error: Error) => {
    console.error(`[Voice] LLM error:`, error);
    session.sendError('llm', error.message, true);
    session.setLLMActive(false);
  });

  // Periodic context updates - LLM decides if it speaks
  const periodicContextHandler = async (context: any) => {
    console.log(`[Voice] 📊 Periodic context for ${session.getSessionId()}: ${context.type}`);

    // Skip if LLM is already streaming (don't interrupt ongoing response)
    if (llm.getIsStreaming()) {
      console.log('[Voice] LLM already streaming, skipping periodic context');
      return;
    }

    // Skip if user is speaking (VAD active)
    if (session.isMicEnabled()) {
      console.log('[Voice] Mic active, skipping periodic context');
      return;
    }

    // Skip if TTS is playing (don't interrupt our own speech)
    if (session.isTTSActive()) {
      console.log('[Voice] TTS active, skipping periodic context');
      return;
    }

    // Send context to LLM - it will DECIDE if there's something worth saying
    session.setLLMActive(true);
    const raceState = raceStateModule.getStateForLLM();
    await llm.sendMessage(context.message, raceState, true);
  };
  raceStateModule.on('periodicContext', periodicContextHandler);

  // Session change handler - LLM gives briefing
  const sessionChangeHandler = async (event: any) => {
    console.log(`[Voice] 🏁 Session change for ${session.getSessionId()}: ${event.data?.sessionType}`);

    // Skip if LLM is already streaming (wait for current response to finish)
    if (llm.getIsStreaming()) {
      console.log('[Voice] LLM already streaming, deferring session change briefing');
      // Could queue it for later, but for now just skip
      return;
    }

    // Build session context message (without relative times/gaps, just static info)
    const sessionData = event.data;
    const standings = sessionData?.standings || [];
    const sessionType = sessionData?.sessionType || 'Unknown';
    const sessionName = sessionData?.sessionName || '';
    const trackName = sessionData?.trackName || 'Unknown';
    const trackConfig = sessionData?.trackConfig || '';
    const totalDrivers = sessionData?.totalDrivers || 0;
    const sof = sessionData?.strengthOfField || 0;
    const playerPosition = sessionData?.playerPosition || 0;
    const playerCarNumber = sessionData?.playerCarNumber || '';
    const trackTemp = sessionData?.trackTemp || 0;
    const airTemp = sessionData?.airTemp || 0;
    const weatherDeclaredWet = sessionData?.weatherDeclaredWet || false;
    const classDistribution = sessionData?.classDistribution || {};

    // Build compact classification message
    let message = `[NUEVA SESIÓN]\n`;
    message += `Tipo: ${sessionType}${sessionName ? ' - ' + sessionName : ''}\n`;
    message += `Circuito: ${trackName}${trackConfig ? ' (' + trackConfig + ')' : ''}\n`;
    message += `Participantes: ${totalDrivers} pilotos (SoF: ${sof})\n`;

    // Class distribution
    if (Object.keys(classDistribution).length > 1) {
      const classInfo = Object.entries(classDistribution)
        .map(([className, count]) => `${count} ${className}`)
        .join(', ');
      message += `Clases: ${classInfo}\n`;
    }

    // Weather/track conditions
    if (weatherDeclaredWet) {
      message += `Condiciones: MOJADO ⚠️\n`;
    }
    message += `Temperaturas: Pista ${trackTemp}°C, Aire ${airTemp}°C\n`;

    // Player starting position
    if (playerPosition > 0) {
      message += `\nTu posición de salida: P${playerPosition}${playerCarNumber ? ' (#' + playerCarNumber + ')' : ''}\n`;
    }

    // Top 5 drivers for context (no times/gaps, just names and iRating)
    const top5 = standings.slice(0, 5);
    if (top5.length > 0) {
      message += `\nTop 5:\n`;
      top5.forEach((driver: any, idx: number) => {
        const pos = idx + 1;
        const name = driver.name || 'Unknown';
        const iRating = driver.iRating || 0;
        const carClass = driver.carClass || '';
        const carNumber = driver.carNumber || '';
        message += `  P${pos}: ${name}${carNumber ? ' #' + carNumber : ''} (${iRating}iR${carClass ? ', ' + carClass : ''})\n`;
      });
    }

    // Send to LLM - it will decide whether to give briefing
    session.setLLMActive(true);
    const raceState = raceStateModule.getStateForLLM();
    await llm.sendMessage(message, raceState, false);
  };
  raceStateModule.on('sessionChange', sessionChangeHandler);

  // Deepgram event handlers
  deepgram.on('connected', () => {
    // intentionally quiet
    session.setSTTConnected(true);
  });

  deepgram.on('disconnected', () => {
    // intentionally quiet
    session.setSTTConnected(false);
  });

  deepgram.on('partial', (text: string, confidence: number | null) => {
    session.sendSTTPartial(text, confidence);
  });

  deepgram.on('final', async (text: string, confidence: number | null) => {
    session.sendSTTFinal(text, confidence);

    // Trigger LLM response
    if (text.trim().length > 0 && !llm.getIsStreaming()) {
      session.setLLMActive(true);
      const raceState = raceStateModule.getStateForLLM();
      await llm.sendMessage(text, raceState, false);
    }
  });

  deepgram.on('utteranceEnd', () => {
    console.log(`[Voice] Utterance ended for session ${session.getSessionId()}`);
  });

  deepgram.on('speechStarted', () => {
    console.log(`[Voice] Speech started for session ${session.getSessionId()}`);
  });

  deepgram.on('error', (error: Error) => {
    console.error(`[Voice] STT error:`, error);
    session.sendError('stt', error.message, true);
  });

  // Session event handlers
  session.on('audioChunk', (chunk: Buffer) => {
    // Forward audio to Deepgram
    deepgram.sendAudio(chunk);
  });

  session.on('micStateChange', (enabled: boolean) => {
    deepgram.setMicEnabled(enabled);
    raceStateModule.setMicEnabled(enabled);
  });

  session.on('interrupt', (reason: string) => {
    console.log(`[Voice] Interrupt: ${reason}`);

    // Abort LLM stream
    if (llm.getIsStreaming()) {
      llm.abort();
      fullLLMResponse = '';
    }

    // Cancel TTS and clear audio buffer
    if (tts.getIsStreaming()) {
      tts.cancel();
    }
    audioAccumulator = [];
  });

  session.on('error', (error: Error) => {
    console.error(`[Voice] Session error:`, error);
  });

  session.on('close', () => {
    console.log(`[Voice] Session closed: ${session.getSessionId()}`);
    deepgram.disconnect();
    tts.disconnect();
    raceStateModule.removeListener('periodicContext', periodicContextHandler);
    raceStateModule.removeListener('sessionChange', sessionChangeHandler);

    // Stop race state module if no more sessions
    if (voiceSessionManager.getSessions().length === 0) {
      raceStateModule.stop();
    }
  });
});

// Rutas API primero (antes del middleware de static)
app.get('/api/latest', (_req: Request, res: Response) => {
  // Return iRacing telemetry only
  const telemetry = lastIRacingTelemetry;
  if (!telemetry) {
    res.status(503).json({ error: 'No telemetry data available yet' });
    return;
  }
  res.json(telemetry);
});

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    clientsConnected: connectedClients.size,
    pythonTelemetryConnected: !!lastIRacingTelemetry,
  });
});

// Gemini Live state endpoint (for MCP bridge)
app.get('/api/gemini/state', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    state: lastGeminiState,
    timestamp: Date.now(),
  });
});

// Latest setup (iRacing via IRSDK or LMU via file watcher)
app.get('/api/setup/latest', (_req: Request, res: Response) => {
  if (!lastSetupData) {
    res.status(503).json({ error: 'No setup data available yet' });
    return;
  }
  res.json(lastSetupData);
});

// ============================================================================
// LAP STORAGE ENDPOINTS
// ============================================================================

// Get current session info (track + car from last telemetry)
app.get('/api/session/current', (_req: Request, res: Response) => {
  if (!lastIRacingTelemetry || !lastIRacingTelemetry.session) {
    res.json({ trackName: null, carName: null });
    return;
  }
  res.json({
    trackName: lastIRacingTelemetry.session.trackName || null,
    trackConfig: lastIRacingTelemetry.session.trackConfig || null,
    carName: lastIRacingTelemetry.car?.name || null,
  });
});

// Get all stored laps (summaries without full telemetry points)
// Optional query params: ?track=X&car=Y to filter by current session
app.get('/api/laps', (req: Request, res: Response) => {
  const { track, car } = req.query;
  
  let laps = lapStorage.getAllLaps();
  
  // Filter by track and car if provided
  if (track && typeof track === 'string') {
    laps = laps.filter(lap => lap.trackName === track);
  }
  if (car && typeof car === 'string') {
    laps = laps.filter(lap => lap.carName === car);
  }
  
  const stats = lapStorage.getStats();
  res.json({
    laps,
    stats,
    filter: { track: track || null, car: car || null }
  });
});

// Get session best lap
app.get('/api/laps/session-best', (_req: Request, res: Response) => {
  const sessionBest = lapStorage.getSessionBest();
  if (!sessionBest) {
    res.status(404).json({ error: 'No session best lap recorded yet' });
    return;
  }
  res.json(sessionBest);
});

// Get last completed lap
app.get('/api/laps/last', (_req: Request, res: Response) => {
  const lastLap = lapStorage.getLastLap();
  if (!lastLap) {
    res.status(404).json({ error: 'No laps recorded yet' });
    return;
  }
  res.json(lastLap);
});

// Get a specific lap by ID or reference (full data with points)
app.get('/api/laps/:id', (req: Request, res: Response) => {
  const id = req.params.id as string;
  
  // Handle special references
  if (id === 'session-best' || id === 'session_best') {
    const sessionBest = lapStorage.getSessionBest();
    if (!sessionBest) {
      res.status(404).json({ error: 'No session best lap recorded yet' });
      return;
    }
    res.json(sessionBest);
    return;
  }
  
  if (id === 'last') {
    const lastLap = lapStorage.getLastLap();
    if (!lastLap) {
      res.status(404).json({ error: 'No laps recorded yet' });
      return;
    }
    res.json(lastLap);
    return;
  }
  
  // Try by reference (handles lap numbers and IDs)
  const lap = lapStorage.getLapByReference(id);
  if (!lap) {
    res.status(404).json({ error: `Lap "${id}" not found` });
    return;
  }
  res.json(lap);
});

// Delete a lap by ID
app.delete('/api/laps/:id', (req: Request, res: Response) => {
  const id = req.params.id as string;
  
  if (id === 'session-best' || id === 'session_best') {
    res.status(400).json({ error: 'Cannot delete session best lap' });
    return;
  }
  
  const deleted = lapStorage.deleteLap(id);
  if (!deleted) {
    res.status(404).json({ error: `Lap ${id} not found or cannot be deleted` });
    return;
  }
  res.json({ success: true, message: `Lap ${id} deleted` });
});

// Reset all laps (new session)
app.post('/api/laps/reset', (_req: Request, res: Response) => {
  lapStorage.resetSession();
  res.json({ success: true, message: 'Session reset - all laps cleared' });
});

// ============================================================================

// PTT Keyboard endpoints
app.get('/api/ptt/keys', (_req: Request, res: Response) => {
  res.json({
    availableKeys: pttKeyboardService.getAvailableKeys(),
    current: pttKeyboardService.getInfo()
  });
});

app.use(express.json());

app.post('/api/ptt/configure', (req: Request, res: Response) => {
  const { key, mode = 'toggle' } = req.body;  // Default: toggle
  
  if (!key) {
    res.status(400).json({ 
      error: 'Missing key parameter',
      availableKeys: pttKeyboardService.getAvailableKeys(),
      availableModes: ['toggle', 'hold']
    });
    return;
  }
  
  // Validar modo
  if (mode !== 'toggle' && mode !== 'hold') {
    res.status(400).json({ 
      error: `Invalid mode: ${mode}. Use 'toggle' or 'hold'`,
      availableModes: ['toggle', 'hold']
    });
    return;
  }
  
  // Detener si ya está corriendo
  if (pttKeyboardService.isActive()) {
    pttKeyboardService.stop();
  }
  
  // Configurar con modo
  if (!pttKeyboardService.configure(key, mode)) {
    res.status(400).json({ 
      error: `Invalid key: ${key}`,
      availableKeys: pttKeyboardService.getAvailableKeys()
    });
    return;
  }
  
  // Iniciar con callbacks que broadcastean a clientes WebSocket
  const started = pttKeyboardService.start({
    onPress: () => broadcastPTTEvent('PTT_PRESS'),
    onRelease: () => broadcastPTTEvent('PTT_RELEASE')
  });
  
  if (started) {
    res.json({ success: true, message: `PTT configurado: ${key} (modo: ${mode})` });
  } else {
    res.status(500).json({ success: false, error: 'No se pudo iniciar PTT' });
  }
});

app.post('/api/ptt/stop', (_req: Request, res: Response) => {
  pttKeyboardService.stop();
  res.json({ success: true, message: 'PTT detenido' });
});

// Broadcast evento PTT a todos los clientes que están listos
function broadcastPTTEvent(event: 'PTT_PRESS' | 'PTT_RELEASE') {
  const message = JSON.stringify({ type: event });
  let sentCount = 0;
  connectedClients.forEach((info, ws) => {
    if (info.isReady && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(message);
        sentCount++;
      } catch (error) {
        console.error('[PTT Broadcast] Error:', (error as Error).message);
      }
    }
  });
  console.log(`[PTT Broadcast] Sent ${event} to ${sentCount} clients`);
}

// Servir archivos estáticos del frontend compilado (para Electron/producción)
const distPath = path.join(__dirname, '..', '..', 'dist');
if (fs.existsSync(distPath)) {
  console.log(`[Server] Serving static files from: ${distPath}`);
  app.use(express.static(distPath));
  
  // Manejar rutas SPA (Single Page Application) - devolver index.html para cualquier ruta no-API
  app.use((req: Request, res: Response, next: NextFunction) => {
    // Solo si no es una ruta API y el archivo no existe
    if (!req.path.startsWith('/api/')) {
      res.sendFile(path.join(distPath, 'index.html'));
    } else {
      next();
    }
  });
} else {
  console.log('[Server] No dist folder found - running in dev mode');
}

wss.on('connection', (ws: WebSocket) => {
  // Add client with ready=false initially
  const clientInfo: ClientInfo = { ws, isReady: false };
  connectedClients.set(ws, clientInfo);
  console.log(`[WebSocket] Client connected. Total: ${connectedClients.size}`);
  
  // Mark this connection as ready after a small delay to ensure handshake is complete
  setTimeout(() => {
    clientInfo.isReady = true;
    // Send welcome message after handshake is fully established
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'CONNECTED' }));
        console.log('[WebSocket] Client marked ready, sent welcome');
      }
    } catch (e) {
      console.error('[WebSocket] Error sending welcome:', (e as Error).message);
    }
  }, 100);
  
  // Manejar mensajes entrantes del cliente
  ws.on('message', (message: Buffer) => {
    if (!clientInfo.isReady) return;  // Ignore messages until ready
    try {
      const data = JSON.parse(message.toString());
      console.log('[WebSocket] Received message:', data.type);
      
      if (data.type === 'REQUEST_SETUP') {
        console.log('[WebSocket] Client requested setup refresh');
        const requestId = data.requestId;
        // Enviar el último setup disponible
        if (lastSetupData) {
          ws.send(JSON.stringify({ type: 'SETUP_DATA', requestId, payload: lastSetupData }));
          console.log('[WebSocket] Sent latest setup to client');
        } else {
          // Provide a typed response so tool callers can fail fast (App.tsx ignores payload=null)
          try {
            ws.send(JSON.stringify({
              type: 'SETUP_DATA',
              requestId,
              payload: null,
              error: 'No setup data available yet'
            }));
          } catch {}
          console.warn('[WebSocket] No setup data available to send');
        }
      } else if (data.type === 'REQUEST_TELEMETRY') {
        const telemetry = lastSimHubTelemetry || lastIRacingTelemetry;
        if (telemetry) {
          ws.send(JSON.stringify({ type: 'TELEMETRY_DATA', payload: telemetry }));
        }
      } else if (data.type === 'GEMINI_STATE') {
        // Update global Gemini state (for MCP bridge)
        lastGeminiState = {
          connected: data.state?.connected ?? false,
          speaking: data.state?.speaking ?? false,
          lastTranscript: data.state?.lastTranscript ?? null,
          lastUpdate: Date.now(),
        };

        // Broadcast Gemini state to all clients (for overlay sync)
        const stateMsg = JSON.stringify({
          type: 'GEMINI_STATE',
          state: data.state,
          isMicActive: data.isMicActive ?? false,
          timestamp: Date.now()
        });
        for (const [client, info] of connectedClients) {
          if (info.isReady && client.readyState === WebSocket.OPEN && client !== ws) {
            client.send(stateMsg);
          }
        }
      } else if (data.type === 'PIT_COMMAND') {
        // Forward pit command to Python telemetry service
        if (!pythonTelemetryWs || pythonTelemetryWs.readyState !== WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'pit_command_response',
            requestId: data.requestId,
            result: { success: false, error: 'Python telemetry service not connected' }
          }));
          return;
        }
        
        const requestId = data.requestId || `pit_${Date.now()}`;
        pendingCommands.set(requestId, { ws, resolve: () => {} });
        
        pythonTelemetryWs.send(JSON.stringify({
          type: 'pit_command',
          requestId,
          command: data.command,
          value: data.value || 0
        }));
        console.log(`[WebSocket] 🔧 Forwarding pit command: ${data.command} = ${data.value || 0}`);
        
      } else if (data.type === 'GET_PIT_STATUS') {
        // Forward pit status request to Python
        if (!pythonTelemetryWs || pythonTelemetryWs.readyState !== WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'pit_status_response',
            requestId: data.requestId,
            result: { success: false, error: 'Python telemetry service not connected' }
          }));
          return;
        }
        
        const requestId = data.requestId || `status_${Date.now()}`;
        pendingCommands.set(requestId, { ws, resolve: () => {} });
        
        pythonTelemetryWs.send(JSON.stringify({
          type: 'get_pit_status',
          requestId
        }));
        console.log('[WebSocket] 📋 Forwarding pit status request');
        
      } else if (data.type === 'CHAT_COMMAND') {
        // Forward chat command to Python
        if (!pythonTelemetryWs || pythonTelemetryWs.readyState !== WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'chat_command_response',
            requestId: data.requestId,
            result: { success: false, error: 'Python telemetry service not connected' }
          }));
          return;
        }
        
        const requestId = data.requestId || `chat_${Date.now()}`;
        pendingCommands.set(requestId, { ws, resolve: () => {} });
        
        pythonTelemetryWs.send(JSON.stringify({
          type: 'chat_command',
          requestId,
          macroNumber: data.macroNumber
        }));
        console.log(`[WebSocket] 💬 Forwarding chat macro: ${data.macroNumber}`);
      }
    } catch (error) {
      console.error('[WebSocket] Error processing client message:', error);
    }
  });
  
  ws.on('close', () => {
    connectedClients.delete(ws);
    console.log(`[WebSocket] Client disconnected. Total: ${connectedClients.size}`);
  });
  
  ws.on('error', (error: Error) => {
    console.error('[WebSocket] Client error:', error.message);
    connectedClients.delete(ws);
  });
});

// ============================================================================
// TELEMETRY WEBSOCKET (/telemetry) - Bridge for iRacing native telemetry
// ============================================================================

telemetryWss.on('connection', (ws: WebSocket) => {
  telemetryClients.add(ws);
  console.log(`[Telemetry WS] Client connected. Total: ${telemetryClients.size}`);
  
  // Send cached telemetry to new client
  if (lastIRacingTelemetry) {
    try {
      ws.send(JSON.stringify(lastIRacingTelemetry));
      console.log('[Telemetry WS] Sent cached telemetry to new client');
    } catch (error) {
      console.error('[Telemetry WS] Error sending cached telemetry:', error);
    }
  }
  
  ws.on('close', () => {
    telemetryClients.delete(ws);
    console.log(`[Telemetry WS] Client disconnected. Total: ${telemetryClients.size}`);
  });
  
  ws.on('error', (error: Error) => {
    console.error('[Telemetry WS] Client error:', error.message);
    telemetryClients.delete(ws);
  });
});

/**
 * Broadcast telemetry to all connected frontend clients
 */
function broadcastTelemetry(data: any) {
  const message = JSON.stringify(data);
  telemetryClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(message);
      } catch (error) {
        console.error('[Telemetry Broadcast] Error:', (error as Error).message);
      }
    }
  });
}

/**
 * Connect to Python telemetry service as a WebSocket client
 * This bridges Python -> Node.js -> Frontend
 */
function connectToPythonTelemetry() {
  let pythonWs: WebSocket | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let isConnecting = false;
  
  function connect() {
    if (isConnecting || (pythonWs && pythonWs.readyState === WebSocket.OPEN)) {
      return;
    }
    
    isConnecting = true;
    const wsUrl = `ws://localhost:${IRACING_TELEMETRY_WS_PORT}`;
    
    console.log(`[Python Bridge] Connecting to ${wsUrl}...`);
    
    try {
      // Disable compression to avoid RSV1 errors when forwarding data
      pythonWs = new WebSocket(wsUrl, { perMessageDeflate: false });
      
      pythonWs.on('open', () => {
        isConnecting = false;
        pythonTelemetryWs = pythonWs;  // Store global reference for sending commands
        pythonCommandExecutor.setPythonWs(pythonWs);  // Update command executor reference
        console.log('[Python Bridge] ✅ Connected to Python telemetry service');
        
        // Clear reconnect timer
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
      });
      
      pythonWs.on('message', (message: Buffer) => {
        try {
          const data = JSON.parse(message.toString());

          // Cache the telemetry
          lastIRacingTelemetry = data;

          // Update race state module for voice pipeline
          if (data.type === 'snapshot' || data.type === 'event') {
            raceStateModule.updateTelemetry(data.data || data);
          }

          // Forward to all frontend clients
          broadcastTelemetry(data);
          
          // Handle lap_recorded events - store in LapStorage
          if (data.type === 'lap_recorded' && data.lap) {
            console.log(`[Python Bridge] 📊 Lap recorded: Lap ${data.lap.lapNumber} (${data.lap.lapTime?.toFixed(3)}s)`);
            
            // The full lap data with points will come in a separate message
            // For now, just log the event - the Python service handles storage
            // We'll sync via REST API calls or a dedicated lap data message
          }
          
          // Handle full lap data message (contains all telemetry points)
          if (data.type === 'lap_data' && data.lapData) {
            console.log(`[Python Bridge] 📊 Full lap data received: Lap ${data.lapData.lapNumber}`);
            lapStorage.storeFullLap(data.lapData);
          }
          
          // Log events (but not every snapshot)
          if (data.type === 'event') {
            console.log(`[Python Bridge] 🎯 Event: ${data.event?.type}`);

            // Handle session_joined event - notify race state module for voice pipeline
            if (data.event?.type === 'session_joined') {
              raceStateModule.notifySessionChange(data.event.data);
            }
          }
          
          // Handle command responses from Python
          if (data.type === 'pit_command_response' || 
              data.type === 'pit_status_response' || 
              data.type === 'chat_command_response') {
            const requestId = data.requestId;
            if (requestId && pendingCommands.has(requestId)) {
              const pending = pendingCommands.get(requestId)!;
              pendingCommands.delete(requestId);
              
              // Forward response to the requesting client
              try {
                if (pending.ws.readyState === WebSocket.OPEN) {
                  pending.ws.send(JSON.stringify(data));
                  console.log(`[Python Bridge] 📤 Forwarded ${data.type} to client`);
                }
              } catch (err) {
                console.error('[Python Bridge] Error forwarding response:', err);
              }
            }
          }
        } catch (error) {
          console.error('[Python Bridge] Parse error:', (error as Error).message);
        }
      });
      
      pythonWs.on('close', () => {
        isConnecting = false;
        pythonTelemetryWs = null;  // Clear global reference
        pythonCommandExecutor.setPythonWs(null);  // Update command executor reference
        console.log('[Python Bridge] Connection closed');
        pythonWs = null;
        scheduleReconnect();
      });
      
      pythonWs.on('error', (error: Error) => {
        isConnecting = false;
        // Only log if not a connection refused (which is expected when Python isn't running)
        if (!error.message.includes('ECONNREFUSED')) {
          console.error('[Python Bridge] Error:', error.message);
        }
      });
      
    } catch (error) {
      isConnecting = false;
      console.error('[Python Bridge] Connection error:', (error as Error).message);
      scheduleReconnect();
    }
  }
  
  function scheduleReconnect() {
    if (reconnectTimer) return;
    
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 5000);  // Reconnect every 5 seconds
  }
  
  // Start initial connection
  connect();
  
  // Return cleanup function
  return () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
    }
    if (pythonWs) {
      pythonWs.close();
    }
  };
}

function startIracingSetupBridge() {
  let pythonProcess: ChildProcess | null = null;
  let retryCount = 0;
  const maxRetries = 3; // Reducido de 5
  
  console.log('[iRacing Setup] === STARTING IRACING SETUP BRIDGE ===');
  
  function spawnPython() {
    const repoRoot = path.join(__dirname, '..', '..');
    const scriptPath = path.join(repoRoot, 'client', 'src', 'utils', 'setup-extract.py');
    const pythonPath = path.join(repoRoot, 'pyirsdk_Reference');
    
    console.log('[iRacing Setup] Configuration:');
    console.log('[iRacing Setup]   Repo root:', repoRoot);
    console.log('[iRacing Setup]   Script path:', scriptPath);
    console.log('[iRacing Setup]   Script exists:', fs.existsSync(scriptPath));
    
    // Si el script no existe, no intentar
    if (!fs.existsSync(scriptPath)) {
      console.log('[iRacing Setup] ⚠️  Script not found - iRacing setup feature disabled');
      console.log('[iRacing Setup] ℹ️  This is optional - only needed for iRacing car setup reading');
      return; // No retry, simplemente desactivar
    }
    
    const pythonCmd = process.platform === 'win32' ? 'py' : 'python3';
    const pythonArgs = process.platform === 'win32' ? ['-3.12', scriptPath] : [scriptPath];
    
    console.log('[iRacing Setup] Starting Python bridge:', pythonCmd, pythonArgs.join(' '));
    
    pythonProcess = spawn(pythonCmd, pythonArgs, {
      cwd: repoRoot,
      env: {
        ...process.env,
        PYTHONPATH: pythonPath,
        PYTHONUNBUFFERED: '1'
      }
    });
    
    console.log('[iRacing Setup] Python process spawned, PID:', pythonProcess.pid);
    
    const rl = readline.createInterface({
      input: pythonProcess.stdout!,
      crlfDelay: Infinity
    });
    
    console.log('[iRacing Setup] Waiting for setup data from Python...');
    
    rl.on('line', (line) => {
      try {
        const data = JSON.parse(line);
        if (data.type === 'IRACING_SETUP' && data.carSetup) {
          lastSetupData = data;
          
          // Log científico del setup recibido
          console.log('[iRacing Setup] ========== SETUP RECEIVED ==========');
          console.log('[iRacing Setup] Timestamp:', data.timestamp);
          console.log('[iRacing Setup] UpdateCount:', data.updateCount);
          console.log('[iRacing Setup] Pit Status:', JSON.stringify(data.pit));
          console.log('[iRacing Setup] Setup Sections:', Object.keys(data.carSetup).join(', '));
          console.log('[iRacing Setup] Total JSON size:', line.length, 'bytes');
          
          // Analizar cada sección en detalle
          console.log('[iRacing Setup] --- Section Details ---');
          for (const [sectionName, sectionData] of Object.entries(data.carSetup)) {
            if (typeof sectionData === 'object' && sectionData !== null) {
              const keys = Object.keys(sectionData);
              console.log(`[iRacing Setup]   ${sectionName}: ${keys.length} fields`);
              if (keys.length > 0) {
                // Mostrar primeros 3 campos como sample
                const sample = keys.slice(0, 3).map(k => `${k}=${JSON.stringify((sectionData as any)[k]).substring(0, 30)}`).join(', ');
                console.log(`[iRacing Setup]      Sample: ${sample}`);
              }
            } else {
              console.log(`[iRacing Setup]   ${sectionName}: ${JSON.stringify(sectionData)}`);
            }
          }
          
          // Verificar si falta Notes
          if (!data.carSetup.Notes && !data.carSetup.DriverInfo) {
            console.log('[iRacing Setup] ⚠️  Notes section missing (would contain car manual)');
          }
          
          console.log('[iRacing Setup] =====================================');
          
          const message = JSON.stringify({ type: 'SETUP_DATA', payload: data });
          let sentCount = 0;
          
          connectedClients.forEach((info, ws) => {
            if (info.isReady && ws.readyState === WebSocket.OPEN) {
              try {
                ws.send(message);
                sentCount++;
              } catch (error) {
                console.error('[Setup Broadcast] Error:', (error as Error).message);
              }
            }
          });
          
          if (sentCount === 0) {
            console.log(`[iRacing Setup] ⚠️  Setup cached but no ready clients`);
          } else {
            console.log(`[iRacing Setup] ✓ Broadcasted to ${sentCount} client(s)`);
          }
        }
      } catch (error) {
        console.error('[iRacing Setup] JSON parse error:', line.substring(0, 100));
      }
    });
    
    pythonProcess.stderr?.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) console.error('[iRacing Setup] stderr:', msg);
    });
    
    pythonProcess.on('error', (error) => {
      console.error('[iRacing Setup] Process error:', error.message);
      retryCount++;
      if (retryCount < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
        console.log(`[iRacing Setup] Retrying in ${delay}ms (${retryCount}/${maxRetries})`);
        setTimeout(spawnPython, delay);
      } else {
        console.error('[iRacing Setup] Max retries reached, giving up');
      }
    });
    
    pythonProcess.on('exit', (code, signal) => {
      console.log(`[iRacing Setup] Process exited (code: ${code}, signal: ${signal})`);
      pythonProcess = null;
      
      // Solo reintentar si el script existe y no hemos alcanzado el máximo
      const repoRoot = path.join(__dirname, '..', '..');
      const scriptPath = path.join(repoRoot, 'client', 'src', 'utils', 'setup-extract.py');
      
      if (code !== 0 && retryCount < maxRetries && fs.existsSync(scriptPath)) {
        retryCount++;
        const delay = 2000; // Fixed 2s delay
        console.log(`[iRacing Setup] Retrying in ${delay}ms (${retryCount}/${maxRetries})`);
        setTimeout(spawnPython, delay);
      } else if (!fs.existsSync(scriptPath)) {
        console.log('[iRacing Setup] Script not found - feature disabled');
      }
    });
    
    retryCount = 0;
  }
  
  spawnPython();
  
  return () => {
    if (pythonProcess) {
      pythonProcess.kill();
      pythonProcess = null;
    }
  };
}

function startLmuSetupBridge() {
  let pythonProcess: ChildProcess | null = null;
  let retryCount = 0;
  const maxRetries = 3;

  console.log('[LMU Setup] === STARTING LMU SETUP BRIDGE ===');

  function spawnPython() {
    const repoRoot = path.join(__dirname, '..', '..');
    const scriptPath = path.join(repoRoot, 'client', 'src', 'utils', 'lmu-setup-extract.py');

    console.log('[LMU Setup] Configuration:');
    console.log('[LMU Setup]   Repo root:', repoRoot);
    console.log('[LMU Setup]   Script path:', scriptPath);
    console.log('[LMU Setup]   Script exists:', fs.existsSync(scriptPath));
    console.log('[LMU Setup]   LMU_SETUP_DIR:', process.env.LMU_SETUP_DIR || '(not set)');

    if (!fs.existsSync(scriptPath)) {
      console.log('[LMU Setup] ⚠️  Script not found - LMU setup feature disabled');
      console.log('[LMU Setup] ℹ️  Optional - only needed for LMU full setup reading from files');
      return;
    }

    const pythonCmd = process.platform === 'win32' ? 'py' : 'python3';
    const pythonArgs = process.platform === 'win32' ? ['-3.12', scriptPath] : [scriptPath];

    console.log('[LMU Setup] Starting Python bridge:', pythonCmd, pythonArgs.join(' '));

    pythonProcess = spawn(pythonCmd, pythonArgs, {
      cwd: repoRoot,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
      }
    });

    console.log('[LMU Setup] Python process spawned, PID:', pythonProcess.pid);

    const rl = readline.createInterface({
      input: pythonProcess.stdout!,
      crlfDelay: Infinity
    });

    console.log('[LMU Setup] Waiting for setup data from Python...');

    rl.on('line', (line) => {
      try {
        const data = JSON.parse(line);
        if (data.type === 'LMU_SETUP' && data.carSetup) {
          lastSetupData = data;

          console.log('[LMU Setup] ========== SETUP RECEIVED ==========');
          console.log('[LMU Setup] Timestamp:', data.timestamp);
          console.log('[LMU Setup] UpdateCount:', data.updateCount);
          console.log('[LMU Setup] Source:', data.source?.file || 'unknown');
          console.log('[LMU Setup] Format:', data.source?.format || 'unknown');

          const message = JSON.stringify({ type: 'SETUP_DATA', payload: data });
          let sentCount = 0;

          connectedClients.forEach((info, ws) => {
            if (info.isReady && ws.readyState === WebSocket.OPEN) {
              try {
                ws.send(message);
                sentCount++;
              } catch (error) {
                console.error('[LMU Setup Broadcast] Error:', (error as Error).message);
              }
            }
          });

          if (sentCount === 0) {
            console.log('[LMU Setup] ⚠️  Setup cached but no ready clients');
          } else {
            console.log(`[LMU Setup] ✓ Broadcasted to ${sentCount} client(s)`);
          }

          console.log('[LMU Setup] =====================================');
        }
      } catch (error) {
        // Ignore non-JSON or partial lines
      }
    });

    pythonProcess.stderr?.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) console.error('[LMU Setup] stderr:', msg);
    });

    pythonProcess.on('error', (error) => {
      console.error('[LMU Setup] Process error:', error.message);
      retryCount++;
      if (retryCount < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
        console.log(`[LMU Setup] Retrying in ${delay}ms (${retryCount}/${maxRetries})`);
        setTimeout(spawnPython, delay);
      } else {
        console.error('[LMU Setup] Max retries reached, giving up');
      }
    });

    pythonProcess.on('exit', (code, signal) => {
      console.log(`[LMU Setup] Process exited (code: ${code}, signal: ${signal})`);
      pythonProcess = null;

      const repoRoot = path.join(__dirname, '..', '..');
      const scriptPath = path.join(repoRoot, 'client', 'src', 'utils', 'lmu-setup-extract.py');

      if (code !== 0 && retryCount < maxRetries && fs.existsSync(scriptPath)) {
        retryCount++;
        const delay = 2000;
        console.log(`[LMU Setup] Retrying in ${delay}ms (${retryCount}/${maxRetries})`);
        setTimeout(spawnPython, delay);
      } else if (!fs.existsSync(scriptPath)) {
        console.log('[LMU Setup] Script not found - feature disabled');
      }
    });

    retryCount = 0;
  }

  spawnPython();

  return () => {
    if (pythonProcess) {
      pythonProcess.kill();
      pythonProcess = null;
    }
  };
}

httpServer.listen(PORT, () => {
  console.log(`[Server] Listening on http://localhost:${PORT}`);
  console.log(`[Server] WebSocket endpoint: ws://localhost:${PORT}/`);
  console.log(`[Server] Telemetry endpoint: ws://localhost:${PORT}/telemetry`);
  console.log(`[Server] HTTP endpoint: http://localhost:${PORT}/api/latest`);
  
  startIracingSetupBridge();
  startLmuSetupBridge();
  
  // 🏎️ Connect to Python telemetry service
  connectToPythonTelemetry();
  
  // 🎮 Auto-configurar PTT Fanatec al iniciar
  initializePTT();
});

/**
 * Inicializa PTT automáticamente con la tecla configurada
 * Por defecto usa F14 en modo HOLD - configúralo en SimHub para que tu botón envíe F14 mientras lo mantienes pulsado
 */
function initializePTT() {
  const PTT_KEY = 'F14';
  const PTT_MODE = 'toggle';
  
  console.log('[PTT] Inicializando PTT por teclado...');
  console.log(`[PTT] 💡 Tecla: ${PTT_KEY} | Modo: ${PTT_MODE.toUpperCase()}`);
  
  if (!pttKeyboardService.configure(PTT_KEY, PTT_MODE)) {
    console.log('[PTT] ❌ Error configurando tecla');
    return;
  }
  
  const started = pttKeyboardService.start({
    onPress: () => {
      console.log('[PTT] 🎙️ TECLA PRESIONADA');
      broadcastPTTEvent('PTT_PRESS');
    },
    onRelease: () => {
      console.log('[PTT] 🔇 TECLA LIBERADA');
      broadcastPTTEvent('PTT_RELEASE');
    }
  });
  
  if (started) {
    console.log(`[PTT] ✅ PTT activo: escuchando tecla ${PTT_KEY}`);
  } else {
    console.log('[PTT] ❌ No se pudo iniciar PTT');
  }
}

process.on('SIGTERM', () => {
  console.log('[Server] SIGTERM received, closing...');
  pttKeyboardService.stop();
  httpServer.close();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[Server] SIGINT received, closing...');
  pttKeyboardService.stop();
  httpServer.close();
  process.exit(0);
});
