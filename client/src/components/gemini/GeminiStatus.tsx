/**
 * GeminiStatus - Complete Gemini state display
 * =============================================
 * 
 * Combines GeminiOrb with optional status text and mic indicator.
 * Used in both Dashboard and Overlay modes.
 */

import { GeminiOrb, GeminiState } from './GeminiOrb';
import { MicIndicator } from './MicIndicator';
import { motion } from 'framer-motion';

interface GeminiStatusProps {
  state: GeminiState;
  isMicActive: boolean;
  size?: 'mini' | 'small' | 'medium' | 'large';
  showLabel?: boolean;
  className?: string;
}

const stateLabels: Record<GeminiState, string> = {
  disconnected: 'Desconectado',
  connecting: 'Conectando...',
  idle: 'Listo',
  listening: 'Escuchando',
  thinking: 'Procesando',
  speaking: 'Hablando',
};

export function GeminiStatus({ 
  state, 
  isMicActive,
  size = 'large', 
  showLabel = true,
  className = '' 
}: GeminiStatusProps) {
  return (
    <div className={`flex flex-col items-center gap-4 ${className}`}>
      {/* The Orb */}
      <GeminiOrb state={state} size={size} />
      
      {/* Status label - only in larger sizes */}
      {showLabel && size !== 'mini' && (
        <motion.div
          className="flex flex-col items-center gap-2"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
        >
          <span className="text-[var(--text-secondary)] text-sm uppercase tracking-wider">
            {stateLabels[state]}
          </span>
          
          {/* Mic indicator below label */}
          <MicIndicator 
            isActive={isMicActive} 
            showWhenInactive={state === 'idle'} 
            size="small"
          />
        </motion.div>
      )}
      
      {/* Mini mode: just mic indicator */}
      {size === 'mini' && (
        <MicIndicator 
          isActive={isMicActive} 
          size="small"
        />
      )}
    </div>
  );
}

export default GeminiStatus;
