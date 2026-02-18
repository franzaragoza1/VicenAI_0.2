/**
 * Overlay - Minimal floating widget
 * ==================================
 *
 * Always-on-top widget that shows Gemini state and mic status.
 * Designed to float over the simulator window.
 *
 * Features:
 * - Transparent background
 * - Draggable
 * - Minimal footprint (~120x140px)
 * - Only shows essential info: Gemini state + PTT active
 *
 * OPTIMIZATION: Uses GeminiOrbLite with CSS animations instead of
 * Framer Motion to reduce CPU usage when hardware acceleration is disabled.
 */

import { useEffect, useState, useRef } from 'react';
import { GeminiOrbLite, GeminiState } from './components/gemini/GeminiOrbLite';
import { MicIndicator } from './components/gemini/MicIndicator';

// Type definition for Electron IPC bridge
declare global {
  interface Window {
    electronOverlay?: {
      moveWindow: (deltaX: number, deltaY: number) => void;
      startDrag: () => void;
      endDrag: () => void;
    };
  }
}

interface OverlayProps {
  geminiState: GeminiState;
  isMicActive: boolean;
  onDoubleClick?: () => void;
}

export function Overlay({ geminiState, isMicActive, onDoubleClick }: OverlayProps) {
  const isDraggingRef = useRef(false);
  const lastMousePosRef = useRef({ x: 0, y: 0 });

  const handleMouseDown = (e: React.MouseEvent) => {
    // Only allow dragging with left mouse button
    if (e.button !== 0) return;
    
    isDraggingRef.current = true;
    lastMousePosRef.current = { x: e.screenX, y: e.screenY };
    if (window.electronOverlay?.startDrag) {
      window.electronOverlay.startDrag();
    }
    e.preventDefault();
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingRef.current) return;
    
    const deltaX = e.screenX - lastMousePosRef.current.x;
    const deltaY = e.screenY - lastMousePosRef.current.y;
    
    // Use Electron IPC to move the window
    if (window.electronOverlay?.moveWindow) {
      window.electronOverlay.moveWindow(deltaX, deltaY);
    }
    
    lastMousePosRef.current = { x: e.screenX, y: e.screenY };
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
    if (window.electronOverlay?.endDrag) {
      window.electronOverlay.endDrag();
    }
  };

  return (
    <div
      className="h-screen w-screen flex items-center justify-center bg-transparent"
      onDoubleClick={onDoubleClick}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* OPTIMIZATION: Replaced motion.div with regular div + CSS transitions */}
      <div
        className="flex flex-col items-center gap-3 p-4 rounded-2xl glass-surface animate-fade-in"
        style={{
          background: 'rgba(10, 10, 15, 0.85)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          cursor: isDraggingRef.current ? 'grabbing' : 'grab',
        }}
        onMouseDown={handleMouseDown}
      >
        {/* OPTIMIZATION: Using GeminiOrbLite with CSS animations instead of Framer Motion */}
        <GeminiOrbLite state={geminiState} size="mini" />
        
        {/* Mic indicator */}
        <MicIndicator
          isActive={isMicActive}
          showWhenInactive={geminiState === 'idle'}
          size="small"
        />
      </div>
    </div>
  );
}

/**
 * Standalone Overlay App
 * Used when loaded in the overlay Electron window
 */
export function OverlayApp() {
  const [geminiState, setGeminiState] = useState<GeminiState>('disconnected');
  const [isMicActive, setIsMicActive] = useState(false);

  useEffect(() => {
    const SERVER_WS_URL = 'ws://localhost:8081';
    let ws: WebSocket | null = null;
    let reconnectTimer: NodeJS.Timeout | null = null;

    const updateState = (newState: GeminiState, newMicActive: boolean) => {
      setGeminiState(newState);
      setIsMicActive(newMicActive);
    };
    
    const connect = () => {
      ws = new WebSocket(SERVER_WS_URL);
      
      ws.onopen = () => {
        console.log('[Overlay] Connected to server');
        updateState('idle', false);
      };
      
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // PTT_PRESS: optimistic immediate update for responsiveness
          if (data.type === 'PTT_PRESS') {
            console.log('[Overlay] 🎙️ MIC ACTIVATED');
            lastUpdateRef.current = Date.now();
            setIsMicActive(true);
            setGeminiState('listening');
          }

          // GEMINI_STATE: authoritative state from main app - always apply
          // isMicActive is now included in the broadcast so we don't derive it
          if (data.type === 'GEMINI_STATE') {
            const newState = data.state as GeminiState;
            const newMicActive = typeof data.isMicActive === 'boolean'
              ? data.isMicActive
              : newState === 'listening';
            updateState(newState, newMicActive);
          }
        } catch (e) {
          // Not JSON, ignore
        }
      };
      
      ws.onclose = () => {
        console.log('[Overlay] WebSocket closed, reconnecting...');
        updateState('disconnected', false);
        reconnectTimer = setTimeout(connect, 2000);
      };
      
      ws.onerror = (err) => {
        console.error('[Overlay] WebSocket error:', err);
      };
    };
    
    connect();
    
    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, []);
  
  const handleDoubleClick = () => {
    // Open main dashboard window
    // In Electron, this would trigger IPC to main process
    console.log('Open main dashboard');
  };
  
  return (
    <Overlay 
      geminiState={geminiState} 
      isMicActive={isMicActive}
      onDoubleClick={handleDoubleClick}
    />
  );
}

export default Overlay;
