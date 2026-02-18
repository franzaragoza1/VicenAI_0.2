/**
 * VICEN Racing Engineer - Main Dashboard
 * =======================================
 * 
 * Voice-first racing companion with visual feedback.
 * Gemini Live is the primary interface; visuals are secondary.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { 
  RacingLayout, 
  GlanceBar, 
  GeminiStatus, 
  FlagBanner, 
  SessionInfo,
  ConnectionStatus,
  GeminiState
} from './components';
import { GeminiLogViewer } from './components/debug/GeminiLogViewer';
import { LapManager } from './components/LapManager';
import { initTelemetryClient, destroyTelemetryClient, getTelemetryClient, initSpotterAudio } from './services/telemetry-client';
import { GeminiLiveService } from './services/gemini-live';
import { VoiceIntegrationService } from './services/voice/voice-integration';
import { setupGeminiLogsHelper } from './utils/gemini-logs-helper';
import type { TelemetryData } from './types/telemetry.types';

// Server WebSocket for PTT events
const SERVER_WS_URL = 'ws://localhost:8081';

// Voice Engine Selection (from .env)
const VOICE_ENGINE = import.meta.env.VITE_VOICE_ENGINE || 'gemini';

function App() {
  // Connection states
  const [telemetryConnected, setTelemetryConnected] = useState(false);
  const [geminiConnected, setGeminiConnected] = useState(false);
  
  // Gemini state
  const [geminiState, setGeminiState] = useState<GeminiState>('disconnected');
  const [isMicActive, setIsMicActive] = useState(false);
  
  // Telemetry data
  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null);
  
  // Debug UI
  const [showLogViewer, setShowLogViewer] = useState(false);
  const [showLapManager, setShowLapManager] = useState(false);
  
  // Service refs
  const geminiServiceRef = useRef<GeminiLiveService | null>(null);
  const voicePipelineRef = useRef<VoiceIntegrationService | null>(null);
  const serverWsRef = useRef<WebSocket | null>(null);
  
  // Cache last setup so it isn't dropped if it arrives before GeminiLiveService initializes
  const latestSetupRef = useRef<any>(null);
  
  // Derive Gemini state from service callbacks
  const handleMicStateChange = useCallback((active: boolean) => {
    setIsMicActive(active);
    if (active) {
      setGeminiState('listening');
    }
  }, []);
  
  const handleSpeakingStateChange = useCallback((speaking: boolean) => {
    if (speaking) {
      setGeminiState('speaking');
    } else if (!isMicActive) {
      setGeminiState('idle');
    }
  }, [isMicActive]);
  
  const handleTranscriptUpdate = useCallback((text: string, isFinal: boolean) => {
    // Could display transcript if needed
    if (isFinal && text) {
      setGeminiState('thinking');
    }
  }, []);
  
  const handleToolCall = useCallback(() => {
    // Tool calls happen during thinking
    return telemetry;
  }, [telemetry]);
  
  // Connect to server WebSocket for PTT events
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let isCleaningUp = false;
    
    const connect = () => {
      if (isCleaningUp) return;
      
      console.log('[PTT] Connecting to', SERVER_WS_URL);
      ws = new WebSocket(SERVER_WS_URL);
      serverWsRef.current = ws;
      
      ws.onopen = () => {
        console.log('[PTT] ✅ Connected to server WebSocket');
      };
      
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('[PTT] Message received:', data.type);
          
          if (data.type === 'CONNECTED') {
            console.log('[PTT] Server confirmed connection');
          } else if (data.type === 'PTT_PRESS') {
            console.log('[PTT] 🎙️ MIC ACTIVATED');
            setIsMicActive(true);
            setGeminiState('listening');

            if (VOICE_ENGINE === 'pipeline') {
              // Voice Pipeline: Enable mic
              if (voicePipelineRef.current) {
                voicePipelineRef.current.setMicEnabled(true);
              }
            } else {
              // Gemini Live: Start recording
              if (geminiServiceRef.current) {
                geminiServiceRef.current.startRecording();
              }
            }
          } else if (data.type === 'PTT_RELEASE') {
            console.log('[PTT] 🔇 MIC DEACTIVATED');
            setIsMicActive(false);

            if (VOICE_ENGINE === 'pipeline') {
              // Voice Pipeline: Disable mic (endpointing will finalize, not PTT release)
              if (voicePipelineRef.current) {
                voicePipelineRef.current.setMicEnabled(false);
              }
              // Don't change geminiState here - let the pipeline manage it
            } else {
              // Gemini Live: Stop recording
              setGeminiState('thinking');
              if (geminiServiceRef.current) {
                geminiServiceRef.current.stopRecording();
              }
            }
          } else if (data.type === 'SETUP_DATA') {
            // Setup data (iRacing via setup-extract.py, LMU via lmu-setup-extract.py)
            console.log('[PTT] 📋 SETUP DATA received:', Object.keys(data.payload || {}));
            if (data.payload) {
              latestSetupRef.current = data.payload;
              if (geminiServiceRef.current) {
                geminiServiceRef.current.updateSetup(data.payload);
              }
            }
          }
        } catch (e) {
          console.warn('[PTT] Non-JSON message:', event.data);
        }
      };
      
      ws.onclose = (event) => {
        console.log('[PTT] WebSocket closed. Code:', event.code, 'Reason:', event.reason);
        serverWsRef.current = null;
        // Reconnect after 3 seconds if not cleaning up
        if (!isCleaningUp) {
          reconnectTimer = setTimeout(connect, 3000);
        }
      };
      
      ws.onerror = (err) => {
        console.error('[PTT] WebSocket error:', err);
      };
    };
    
    connect();
    
    return () => {
      isCleaningUp = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
      serverWsRef.current = null;
    };
  }, []);
  
  // Send Gemini state to server (for overlay sync)
  useEffect(() => {
    if (serverWsRef.current && serverWsRef.current.readyState === WebSocket.OPEN) {
      serverWsRef.current.send(JSON.stringify({
        type: 'GEMINI_STATE',
        state: geminiState,
        isMicActive,
      }));
    }
  }, [geminiState, isMicActive]);
  
  // Initialize telemetry client
  useEffect(() => {
    const client = initTelemetryClient(
      // onSnapshot callback
      (data) => {
        setTelemetry(data);
        setTelemetryConnected(true);
        
        // Update Gemini service with telemetry
        if (geminiServiceRef.current) {
          geminiServiceRef.current.updateTelemetry(data);
        }
      },
      // options
      { debug: false },
      // simhubCallback (for SimHub UDP data)
      undefined,
      // sessionJoinedCallback
      (eventData) => {
        console.log('[App] 📋 Session joined with', eventData.totalDrivers, 'drivers');
        if (geminiServiceRef.current) {
          geminiServiceRef.current.sendSessionJoinedEvent(eventData);
        }
      },
      // raceEventCallback - IMPORTANT: Makes Gemini talk proactively!
      (eventType, eventData, telemetry) => {
        console.log('[App] 🏁 Race event:', eventType);
        if (geminiServiceRef.current) {
          geminiServiceRef.current.handleRaceEvent(eventType, eventData, telemetry);
        }
      }
    );
    
    return () => {
      destroyTelemetryClient();
    };
  }, []);
  
  // Initialize Voice service (Gemini or Pipeline based on env)
  useEffect(() => {
    console.log(`[App] 🎙️ Voice Engine: ${VOICE_ENGINE}`);

    if (VOICE_ENGINE === 'pipeline') {
      // === NEW PIPELINE (Deepgram + Qwen3 + Cartesia) ===
      console.log('[App] Initializing Voice Pipeline...');

      const voiceService = new VoiceIntegrationService();

      voiceService.initialize({
        onTranscriptPartial: (text) => {
          console.log('[VoicePipeline] Partial:', text);
        },
        onTranscriptFinal: (text) => {
          console.log('[VoicePipeline] Final:', text);
          handleTranscriptUpdate(text, true);
        },
        onSpeakingChange: (speaking) => {
          // speaking=true: engineer started talking → green orb
          // speaking=false: audio finished playing (from onPlaybackEnd) → back to idle
          handleSpeakingStateChange(speaking);
        },
        onStateChange: (state) => {
          setGeminiConnected(state.stt === 'connected');
          setIsMicActive(state.micEnabled);
          if (state.llm === 'streaming') {
            setGeminiState('thinking');
          } else if (state.tts === 'streaming' || state.speaking) {
            // Server sending audio → speaking. onPlaybackEnd clears this back to idle
            setGeminiState('speaking');
          } else if (state.micEnabled) {
            setGeminiState('listening');
          } else {
            // Only go idle when no audio is playing (guarded by onPlaybackEnd)
            setGeminiState((prev) => (prev === 'speaking' ? prev : 'idle'));
          }
        },
        onError: (scope, message) => {
          console.error(`[VoicePipeline] Error [${scope}]:`, message);
        },
      }).then(async () => {
        // 🔊 Initialize spotter audio after voice pipeline connects (user has interacted)
        try {
          await initSpotterAudio();
          console.log('[App] ✅ Spotter audio ready');
        } catch (audioError) {
          console.error('[App] ❌ Spotter audio initialization failed:', audioError);
          // Continue without spotter audio - voice pipeline should still work
        }
      }).catch((error) => {
        console.error('[App] Failed to initialize Voice Pipeline:', error);
      });

      voicePipelineRef.current = voiceService;

      console.log('[App] Voice Pipeline initialized');

      return () => {
        voiceService.dispose();
      };

    } else {
      // === GEMINI LIVE (Original/Fallback) ===
      console.log('[App] Initializing Gemini Live...');

      const initialContext = telemetry ? {
        trackName: telemetry.session?.trackName,
        carName: telemetry.session?.carName,
        sessionType: telemetry.session?.type,
        simulator: telemetry.simulator || 'Unknown',
      } : {
        trackName: 'Unknown Track',
        carName: 'Unknown Car',
        sessionType: 'Practice',
        simulator: 'Unknown',
      };

      const service = GeminiLiveService.getInstance(
        handleMicStateChange,
        handleSpeakingStateChange,
        handleTranscriptUpdate,
        handleToolCall,
        initialContext,
        getTelemetryClient() || undefined,
        () => {
          setGeminiConnected(false);
          setGeminiState('disconnected');
        },
        () => {
          setGeminiConnected(true);
          setGeminiState('idle');
        }
      );

      geminiServiceRef.current = service;

      if (latestSetupRef.current) {
        service.updateSetup(latestSetupRef.current);
      }

      (window as any).testGeminiEvent = (eventType: string) => {
        if (geminiServiceRef.current) {
          geminiServiceRef.current.injectTestEvent(eventType);
        } else {
          console.error('Gemini service not available');
        }
      };

      setupGeminiLogsHelper(service);

      (window as any).getGeminiStatus = () => {
        if (geminiServiceRef.current) {
          return geminiServiceRef.current.getConnectionStatus();
        }
        console.error('Gemini service not available');
        return null;
      };

      console.log('[App] 🧪 Test function available: window.testGeminiEvent("green_flag")');
      console.log('[App]    Events: green_flag, position_gain, position_loss, best_lap, yellow_flag, fuel_warning, last_lap, checkered, incident');
      console.log('[App] 📝 Debug logging:');
      console.log('[App]    - PANEL VISUAL: Click "📝 Debug Logs" button or press Ctrl+L');
      console.log('[App]    - Consola: logs aparecen automáticamente en formato plano');
      console.log('[App]    - window.getGeminiLogs() / getGeminiLogSummary() / clearGeminiLogs()');
      console.log('[App]    - window.exportGeminiLogs() - Export as JSON + clipboard');
      console.log('[App]    - window.setGeminiLogging(true/false) - Enable/disable');

      // ✅ FIXED: Auto-connect IMMEDIATELY, don't wait for iRacing session
      console.log('[App] 🤖 Connecting Gemini Live immediately...');
      setGeminiState('connecting');
      service.connect(initialContext).then(async () => {
        setGeminiConnected(true);
        setGeminiState('idle');
        console.log('[App] ✅ Gemini Live connected and ready');      // 🔊 Initialize spotter audio after Gemini connects (user has interacted)
        try {
          await initSpotterAudio();
          console.log('[App] ✅ Spotter audio ready');
        } catch (audioError) {
          console.error('[App] ❌ Spotter audio initialization failed:', audioError);
          // Continue without spotter audio - Gemini Live audio should still work
        }
      }).catch((err) => {
        console.error('[App] ❌ Gemini connection failed:', err);
        setGeminiState('disconnected');
      });

      return () => {
        // 🔒 SINGLETON: Don't destroy the singleton on cleanup - it will be reused
        // Only disconnect if the component is truly unmounting (not just re-rendering)
        // The singleton pattern handles this - getInstance will return the same instance
        console.log('[App] 🧹 Cleanup: clearing local refs (singleton preserved)');
        geminiServiceRef.current = null;
        delete (window as any).testGeminiEvent;
        delete (window as any).getGeminiLogs;
        delete (window as any).getGeminiLogSummary;
        delete (window as any).clearGeminiLogs;
        delete (window as any).exportGeminiLogs;
        delete (window as any).setGeminiLogging;
      };
    }
  }, []); // ✅ FIXED: Keep singleton stable, avoid reconnects on re-renders
  
  // Keyboard shortcut to open log viewer (Ctrl+L) and overlay (F10)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+L = Debug Log Viewer
      if (e.ctrlKey && e.key === 'l' && geminiConnected) {
        e.preventDefault();
        setShowLogViewer(prev => !prev);
      }
      
      // F10 = Open Overlay (only in browser mode, Electron handles it globally)
      // En Electron, el globalShortcut maneja F10, no el código de React
      const isElectron = navigator.userAgent.toLowerCase().includes('electron');
      
      if (e.key === 'F10' && !isElectron) {
        e.preventDefault();
        window.open('/overlay.html', 'vicen-overlay', 'width=160,height=180,toolbar=no,menubar=no,resizable=no');
        console.log('[App] 🖼️ Overlay window opened (F10) - Browser mode');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [geminiConnected]);

  // Update mic state based on PTT
  useEffect(() => {
    if (!isMicActive && geminiState === 'listening') {
      setGeminiState('thinking');
    }
  }, [isMicActive, geminiState]);
  
  // Extract telemetry values with defaults
  const position = telemetry?.position?.overall ?? 0;
  const totalCars = telemetry?.position?.totalCars ?? 0;
  const classPosition = telemetry?.position?.class;
  const gapAhead = telemetry?.gaps?.ahead ?? 0;
  const gapBehind = telemetry?.gaps?.behind ?? 0;
  const fuelLevel = telemetry?.fuel?.level ?? 0;
  const fuelPerLap = telemetry?.fuel?.perLapAvg ?? 0;
  const flags = telemetry?.flags?.active ?? [];
  const trackName = telemetry?.session?.trackName;
  const carName = telemetry?.session?.carName;
  const sessionType = telemetry?.session?.type;

  return (
    <>
      <RacingLayout
        topBar={
          <div className="flex items-center justify-between w-full">
            <span className="text-[var(--text-muted)] text-sm font-medium">
              VICEN Racing Engineer
            </span>
            <div className="flex items-center gap-4">
              {/* Lap Manager Button */}
              {telemetryConnected && (
                <button
                  onClick={() => setShowLapManager(true)}
                  className="px-3 py-1 bg-green-600 hover:bg-green-500 rounded text-white text-sm font-medium transition-colors"
                  title="Gestionar vueltas y comparaciones"
                >
                  🏁 Laps
                </button>
              )}
              {/* Debug Logs Button */}
              {geminiConnected && (
                <button
                  onClick={() => setShowLogViewer(true)}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded text-white text-sm font-medium transition-colors"
                  title="Ver logs de comunicación con Gemini"
                >
                  📝 Debug Logs
                </button>
              )}
              <ConnectionStatus 
                telemetryConnected={telemetryConnected}
                geminiConnected={geminiConnected}
              />
            </div>
          </div>
        }
        heroContent={
          <div className="flex flex-col items-center gap-4">
            <GeminiStatus 
              state={geminiState}
              isMicActive={isMicActive}
              size="large"
              showLabel={true}
            />
            
            {/* Flag banner appears above everything when active */}
            <FlagBanner flags={flags} />
          </div>
        }
        glanceContent={
          telemetryConnected && telemetry ? (
            <GlanceBar
              position={position}
              totalCars={totalCars}
              classPosition={classPosition !== position ? classPosition : undefined}
              gapAhead={gapAhead}
              gapBehind={gapBehind}
              fuelLevel={fuelLevel}
              fuelPerLap={fuelPerLap}
            />
          ) : (
            <div className="text-[var(--text-muted)] text-center">
              <p className="text-lg">Esperando telemetría...</p>
              <p className="text-sm mt-1">Asegúrate de que iRacing está corriendo</p>
            </div>
          )
        }
        detailContent={
          <SessionInfo
            trackName={trackName}
            carName={carName}
            sessionType={sessionType}
          />
        }
      />

      {/* Debug Log Viewer */}
      <GeminiLogViewer
        geminiService={geminiServiceRef.current}
        isOpen={showLogViewer}
        onClose={() => setShowLogViewer(false)}
      />

      {/* Lap Manager */}
      <LapManager
        isOpen={showLapManager}
        onClose={() => setShowLapManager(false)}
      />
    </>
  );
}

export default App;
