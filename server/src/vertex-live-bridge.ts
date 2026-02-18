import { GoogleGenAI, Modality } from '@google/genai';
import { WebSocketServer, WebSocket } from 'ws';
import { createHash } from 'crypto';

interface SystemInstructionMeta {
  hash: string;
  length: number;
  origin: string;
  preview: string;
}

type ClientMessage =
  | { type: 'setup'; systemInstruction?: string; systemInstructionMeta?: SystemInstructionMeta }
  | { type: 'audio_chunk'; mimeType: string; data: string }
  | { type: 'audio_end' }
  | { type: 'text_turn'; text: string; turnComplete?: boolean }
  | { type: 'client_content'; content: { turns: any[]; turnComplete?: boolean } }
  | { type: 'tool_response'; functionResponses: any[] };

interface VertexConfig {
  projectId: string;
  location: string;
  ragCorpusId?: string;
  model: string;
  enableRag: boolean;
}

export class VertexLiveBridge {
  private vertexAi: GoogleGenAI | null = null;
  private clientSessions = new Map<WebSocket, any>();
  private config: VertexConfig | null = null;
  private setupTimeouts = new Map<WebSocket, NodeJS.Timeout>();

  constructor(private wss: WebSocketServer) {
    this.initializeVertexConfig();
    this.setupWebSocketServer();
  }

  private parseEnvBool(name: string, defaultValue: boolean): boolean {
    const raw = process.env[name];
    if (raw === undefined) return defaultValue;

    const v = raw.trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(v)) return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(v)) return false;

    console.warn(`[VertexBridge] ⚠️ Invalid ${name} value: "${raw}". Using default=${defaultValue}`);
    return defaultValue;
  }

  private computeSha256(text: string): string {
    return createHash('sha256').update(text, 'utf8').digest('hex');
  }

  private buildPromptPreview(text: string, maxLength = 300): string {
    return text.replace(/\s+/g, ' ').trim().slice(0, maxLength);
  }

  private maskProjectId(projectId: string): string {
    if (projectId.length <= 4) return projectId;
    return `${projectId.slice(0, 3)}***${projectId.slice(-2)}`;
  }

  private logSystemInstructionMeta(systemInstruction: string, meta?: SystemInstructionMeta): void {
    const serverHash = this.computeSha256(systemInstruction);
    const serverLength = systemInstruction.length;
    const serverPreview = this.buildPromptPreview(systemInstruction);

    if (!meta) {
      console.warn('[VertexBridge] ⚠️ setup received without systemInstructionMeta');
      console.log('[VertexBridge] 🧾 System prompt fingerprint (server only)', {
        hash: serverHash,
        length: serverLength,
        origin: '(unknown)',
        preview: serverPreview,
      });
      return;
    }

    const hashMatches = meta.hash === serverHash;
    const lengthMatches = meta.length === serverLength;

    console.log(`[VertexBridge] ${hashMatches && lengthMatches ? '✅' : '⚠️'} System prompt integrity`, {
      hashMatches,
      lengthMatches,
      client: {
        hash: meta.hash,
        length: meta.length,
        origin: meta.origin,
        preview: meta.preview,
      },
      server: {
        hash: serverHash,
        length: serverLength,
        preview: serverPreview,
      },
    });
  }

  private initializeVertexConfig(): void {
    // Check if we should use Gemini API directly instead of Vertex AI
    const geminiApiKey = process.env.VITE_GEMINI_API_KEY;
    const useGeminiApi = !process.env.VERTEX_PROJECT_ID || geminiApiKey;

    if (useGeminiApi && geminiApiKey) {
      console.log('[VertexBridge] 🔑 Using Gemini API (not Vertex AI)');

      const selectedModel = process.env.VERTEX_GEMINI_LIVE_MODEL || 'gemini-2.0-flash-exp';

      this.config = {
        projectId: 'gemini-api',
        location: 'global',
        ragCorpusId: undefined,
        model: selectedModel,
        enableRag: false,
      };

      this.vertexAi = new GoogleGenAI({
        apiKey: geminiApiKey,
      });

      console.log('[VertexBridge] ✅ Gemini API initialized', {
        model: selectedModel,
        mode: 'Gemini API (direct)',
      });
      return;
    }

    // Original Vertex AI path
    const projectId = process.env.VERTEX_PROJECT_ID;
    const location = process.env.VERTEX_LOCATION || 'us-central1';
    const ragCorpusId = process.env.VERTEX_RAG_CORPUS_ID;
    const rawEnableRag = process.env.VERTEX_ENABLE_RAG;
    const enableRag = this.parseEnvBool('VERTEX_ENABLE_RAG', false);

    if (!projectId) {
      console.warn('[VertexBridge] ⚠️ Missing VERTEX_PROJECT_ID and VITE_GEMINI_API_KEY');
      console.warn('[VertexBridge] Gemini Live features will be disabled');
      return;
    }

    if (enableRag && !ragCorpusId) {
      console.warn('[VertexBridge] ⚠️ VERTEX_ENABLE_RAG=true but VERTEX_RAG_CORPUS_ID is missing');
      console.warn('[VertexBridge] RAG will be disabled for this run');
    }

    const effectiveEnableRag = enableRag && !!ragCorpusId;

    // 🔧 CONFIGURABLE MODEL: Priorizar env var sobre selección automática
    const envModel = process.env.VERTEX_GEMINI_LIVE_MODEL;

    let selectedModel: string;
    if (envModel) {
      // Usuario especificó modelo manualmente - respetarlo
      selectedModel = envModel.startsWith('publishers/google/models/')
        ? envModel
        : `publishers/google/models/${envModel}`;
      console.log(`[VertexBridge] 📌 Using MANUAL model from VERTEX_GEMINI_LIVE_MODEL: ${selectedModel}`);
    } else {
      // Selección automática basada en RAG
      selectedModel = effectiveEnableRag
        ? 'publishers/google/models/gemini-live-2.5-flash-native-audio'
        : 'publishers/google/models/gemini-live-2.5-flash-preview-native-audio-12-2025';
      console.log(`[VertexBridge] 🤖 Auto-selected model based on RAG=${effectiveEnableRag}: ${selectedModel}`);
    }

    console.log('[VertexBridge] 🔎 Vertex env diagnostics', {
      rawEnableRag: rawEnableRag ?? '(unset)',
      parsedEnableRag: enableRag,
      effectiveEnableRag,
      rawModelEnv: envModel ?? '(unset)',
      selectedModel,
    });

    this.config = {
      projectId,
      location,
      ragCorpusId: ragCorpusId || undefined,
      model: selectedModel,
      enableRag: effectiveEnableRag,
    };

    this.vertexAi = new GoogleGenAI({
      vertexai: true,
      project: projectId,
      location: location,
    });

    console.log('[VertexBridge] ✅ Vertex AI initialized', {
      projectId,
      location,
      model: selectedModel,
      enableRag: effectiveEnableRag,
      ragCorpusId: effectiveEnableRag && ragCorpusId ? ragCorpusId.substring(0, 20) + '...' : '(disabled)',
    });
  }

  private setupWebSocketServer(): void {
    this.wss.on('connection', (clientWs: WebSocket) => {
      console.log('[VertexBridge] 🔌 Client connected');

      if (!this.vertexAi || !this.config) {
        console.error('[VertexBridge] ❌ Vertex AI not configured, closing connection');
        clientWs.send(JSON.stringify({ type: 'error', error: 'Vertex AI not configured. Check server logs.' }));
        clientWs.close();
        return;
      }

      const timeout = setTimeout(() => {
        if (clientWs.readyState === WebSocket.OPEN && !this.clientSessions.has(clientWs)) {
          clientWs.send(JSON.stringify({ type: 'error', error: 'Missing setup message' }));
          clientWs.close();
        }
      }, 8000);
      this.setupTimeouts.set(clientWs, timeout);

      clientWs.on('message', (rawMessage: Buffer) => {
        this.handleClientMessage(clientWs, rawMessage);
      });

      clientWs.on('close', () => {
        console.log('[VertexBridge] 🔌 Client disconnected');
        const setupTimeout = this.setupTimeouts.get(clientWs);
        if (setupTimeout) {
          clearTimeout(setupTimeout);
          this.setupTimeouts.delete(clientWs);
        }
        const session = this.clientSessions.get(clientWs);
        if (session) {
          try {
            session.close();
          } catch (e) {
            console.warn('[VertexBridge] Error closing Vertex session:', e);
          }
          this.clientSessions.delete(clientWs);
        }
      });

      clientWs.on('error', (error) => {
        console.error('[VertexBridge] Client error:', error);
      });
    });
  }

  private async connectToVertex(
    clientWs: WebSocket,
    setup: { systemInstruction?: string; systemInstructionMeta?: SystemInstructionMeta },
  ): Promise<void> {
    if (!this.vertexAi || !this.config) {
      throw new Error('Vertex AI not initialized');
    }

    if (!setup.systemInstruction) {
      throw new Error('systemInstruction is required from client');
    }

    const systemInstruction = setup.systemInstruction;
    console.log('[VertexBridge] 📏 System instruction size:', systemInstruction.length, 'characters');
    this.logSystemInstructionMeta(systemInstruction, setup.systemInstructionMeta);

    const tools: any[] = [
      {
        functionDeclarations: this.buildFunctionDeclarations(),
      },
    ];

    if (this.config.enableRag && this.config.ragCorpusId) {
      const ragCorpusName = `projects/${this.config.projectId}/locations/${this.config.location}/ragCorpora/${this.config.ragCorpusId}`;
      tools.unshift({
        retrieval: {
          vertexRagStore: {
            ragResources: [{ ragCorpus: ragCorpusName }],
            similarityTopK: 5,
          },
        },
      });
    }

    const config = {
      model: this.config.model,
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Enceladus' } },
        },
        systemInstruction,
        tools,
      },
    };

    console.log('[VertexBridge] 🔧 Connection config:', JSON.stringify({
      model: config.model,
      responseModalities: config.config.responseModalities,
      voiceName: config.config.speechConfig?.voiceConfig?.prebuiltVoiceConfig?.voiceName,
      systemInstructionLength: systemInstruction.length,
      toolsCount: tools.length,
    }, null, 2));

    const session = await this.vertexAi.live.connect({
      ...config,
      callbacks: {
        onopen: () => {
          console.log('[VertexBridge] 🎯 Vertex session opened');
          clientWs.send(
            JSON.stringify({
              type: 'session_config',
              model: this.config?.model || '(unknown)',
              ragEnabled: !!this.config?.enableRag,
              retrievalAttached: !!(this.config?.enableRag && this.config?.ragCorpusId),
              location: this.config?.location || '(unknown)',
              projectIdMasked: this.config?.projectId ? this.maskProjectId(this.config.projectId) : '(unknown)',
            }),
          );
          clientWs.send(JSON.stringify({ type: 'connected' }));
        },
        onmessage: (msg: any) => {
          this.handleVertexMessage(clientWs, msg);
        },
        onclose: (event: any) => {
          console.log('[VertexBridge] 🔌 Vertex session closed');
          console.log('[VertexBridge] 🔍 Close event details:', JSON.stringify(event, null, 2));
          clientWs.close();
        },
        onerror: (err: any) => {
          console.error('[VertexBridge] ❌ Vertex error:', err);
          console.error('[VertexBridge] 🔍 Full error object:', JSON.stringify(err, Object.getOwnPropertyNames(err), 2));
          clientWs.send(JSON.stringify({ type: 'error', error: err.message }));
        },
      },
    });

    this.clientSessions.set(clientWs, session);
  }

  private handleClientMessage(clientWs: WebSocket, rawMessage: Buffer): void {
    try {
      const message: ClientMessage = JSON.parse(rawMessage.toString());
      const session = this.clientSessions.get(clientWs);

      switch (message.type) {
        case 'setup': {
          if (session) return;
          const setupTimeout = this.setupTimeouts.get(clientWs);
          if (setupTimeout) {
            clearTimeout(setupTimeout);
            this.setupTimeouts.delete(clientWs);
          }
          this.connectToVertex(clientWs, message)
            .then(() => console.log('[VertexBridge] ✅ Vertex session established'))
            .catch((err) => {
              console.error('[VertexBridge] ❌ Failed to connect to Vertex:', err);
              clientWs.send(JSON.stringify({ type: 'error', error: err?.message || String(err) }));
              clientWs.close();
            });
          break;
        }

        case 'audio_chunk':
          if (session) {
            session.sendRealtimeInput({
              media: {
                mimeType: message.mimeType,
                data: message.data,
              },
            });
          }
          break;

        case 'audio_end':
          if (session) session.sendRealtimeInput({ audioStreamEnd: true });
          break;

        case 'text_turn':
          if (session) {
            session.sendClientContent({
              turns: [{ role: 'user', parts: [{ text: message.text }] }],
              turnComplete: message.turnComplete ?? true,
            });
          }
          break;

        case 'client_content':
          if (session) session.sendClientContent(message.content);
          break;

        case 'tool_response':
          if (session) session.sendToolResponse({ functionResponses: message.functionResponses });
          break;

        default:
          console.warn('[VertexBridge] Unknown message type:', (message as any).type);
      }
    } catch (error) {
      console.error('[VertexBridge] Error handling client message:', error);
    }
  }

  private handleVertexMessage(clientWs: WebSocket, msg: any): void {
    console.log('[VertexBridge] 📨 Received message from Vertex:', JSON.stringify(msg, null, 2).substring(0, 500));
    if (msg.serverContent?.modelTurn?.parts) {
      for (const part of msg.serverContent.modelTurn.parts) {
        if (part.inlineData?.data) {
          clientWs.send(
            JSON.stringify({
              type: 'model_audio',
              mimeType: 'audio/pcm;rate=24000',
              data: part.inlineData.data,
            }),
          );
        }

        if (part.text) {
          clientWs.send(
            JSON.stringify({
              type: 'model_text',
              text: part.text,
            }),
          );
        }
      }
    }

    if (msg.serverContent?.turnComplete) {
      clientWs.send(JSON.stringify({ type: 'model_turn_complete' }));
    }

    if (msg.toolCall?.functionCalls) {
      clientWs.send(JSON.stringify({ type: 'tool_call', toolCall: msg.toolCall }));
    }

    if (msg.serverContent?.groundingMetadata) {
      clientWs.send(
        JSON.stringify({
          type: 'grounding',
          metadata: msg.serverContent.groundingMetadata,
        }),
      );
    }
  }

  private buildFunctionDeclarations(): any[] {
    return [
      {
        name: 'get_session_context',
        description: 'Returns complete race data: lap times, position, gaps, standings',
        parameters: { type: 'OBJECT', properties: {} },
      },
      {
        name: 'get_vehicle_setup',
        description: 'Returns vehicle setup data (only in iRacing)',
        parameters: { type: 'OBJECT', properties: {} },
      },
      {
        name: 'get_recent_events',
        description: 'Returns last 20 race events',
        parameters: { type: 'OBJECT', properties: {} },
      },
      {
        name: 'request_current_setup',
        description: 'Requests latest car setup from simulator',
        parameters: { type: 'OBJECT', properties: {} },
      },
      {
        name: 'compare_laps',
        description: 'Generates telemetry comparison between two laps',
        parameters: {
          type: 'OBJECT',
          properties: {
            lap1: { type: 'STRING', description: 'First lap: session_best, last, or lap number' },
            lap2: { type: 'STRING', description: 'Second lap: session_best, last, or lap number' },
          },
        },
      },
      {
        name: 'configure_pit_stop',
        description: 'Configures next pit stop in iRacing',
        parameters: {
          type: 'OBJECT',
          properties: {
            action: { type: 'STRING', description: 'Action: clear_all, add_fuel, change_tires, fast_repair, windshield' },
            fuelAmount: { type: 'NUMBER', description: 'Liters to add (for add_fuel)' },
            tires: { type: 'STRING', description: 'Which tires: all, fronts, rears, left, right, lf, rf, lr, rr' },
          },
          required: ['action'],
        },
      },
      {
        name: 'get_pit_status',
        description: 'Returns current pit stop configuration',
        parameters: { type: 'OBJECT', properties: {} },
      },
      {
        name: 'send_chat_macro',
        description: 'Sends predefined chat macro (1-15)',
        parameters: {
          type: 'OBJECT',
          properties: {
            macroNumber: { type: 'NUMBER', description: 'Macro number 1-15' },
          },
          required: ['macroNumber'],
        },
      },
    ];
  }
}
