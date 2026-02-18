/**
 * GeminiOrb - The hero visual component
 * =====================================
 * 
 * Displays Gemini's current state through color and animation.
 * No text needed - state is communicated purely visually.
 * 
 * States:
 * - disconnected: Gray, static
 * - connecting: Amber, slow pulse
 * - idle: Cyan, breathing
 * - listening: Cyan, waves inward (PTT active)
 * - thinking: Violet, orbiting particles
 * - speaking: Green, waves outward
 */

import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export type GeminiState = 
  | 'disconnected' 
  | 'connecting' 
  | 'idle' 
  | 'listening' 
  | 'thinking' 
  | 'speaking';

interface GeminiOrbProps {
  state: GeminiState;
  size?: 'mini' | 'small' | 'medium' | 'large';
  className?: string;
}

const sizeMap = {
  mini: 80,
  small: 120,
  medium: 200,
  large: 280,
};

const colorMap: Record<GeminiState, string> = {
  disconnected: '#3A3A4A',
  connecting: '#FFB800',
  idle: '#00D9FF',
  listening: '#00D9FF',
  thinking: '#8B5CF6',
  speaking: '#00FF88',
};

const glowMap: Record<GeminiState, string> = {
  disconnected: 'none',
  connecting: '0 0 30px rgba(255, 184, 0, 0.4)',
  idle: '0 0 40px rgba(0, 217, 255, 0.3)',
  listening: '0 0 60px rgba(0, 217, 255, 0.5)',
  thinking: '0 0 50px rgba(139, 92, 246, 0.5)',
  speaking: '0 0 60px rgba(0, 255, 136, 0.5)',
};

export function GeminiOrb({ state, size = 'large', className = '' }: GeminiOrbProps) {
  const dimension = sizeMap[size];
  const color = colorMap[state];
  const glow = glowMap[state];
  
  // Number of ripple rings
  const rippleCount = 3;
  
  return (
    <div 
      className={`relative flex items-center justify-center ${className}`}
      style={{ width: dimension, height: dimension }}
    >
      {/* Background glow */}
      <motion.div
        className="absolute inset-0 rounded-full"
        animate={{
          boxShadow: glow,
          scale: state === 'idle' ? [1, 1.05, 1] : 1,
        }}
        transition={{
          boxShadow: { duration: 0.3 },
          scale: { duration: 3, repeat: Infinity, ease: 'easeInOut' },
        }}
      />
      
      {/* Ripple waves - Listening (inward) */}
      <AnimatePresence>
        {state === 'listening' && (
          <>
            {Array.from({ length: rippleCount }).map((_, i) => (
              <motion.div
                key={`ripple-in-${i}`}
                className="absolute rounded-full border-2"
                style={{ 
                  borderColor: color,
                  width: dimension * 1.5,
                  height: dimension * 1.5,
                }}
                initial={{ scale: 1.5, opacity: 0 }}
                animate={{ scale: 0.7, opacity: [0, 0.5, 0] }}
                transition={{
                  duration: 1.5,
                  repeat: Infinity,
                  delay: i * 0.5,
                  ease: 'easeOut',
                }}
              />
            ))}
          </>
        )}
      </AnimatePresence>
      
      {/* Ripple waves - Speaking (outward) */}
      <AnimatePresence>
        {state === 'speaking' && (
          <>
            {Array.from({ length: rippleCount }).map((_, i) => (
              <motion.div
                key={`ripple-out-${i}`}
                className="absolute rounded-full border-2"
                style={{ 
                  borderColor: color,
                  width: dimension * 0.8,
                  height: dimension * 0.8,
                }}
                initial={{ scale: 0.8, opacity: 0.8 }}
                animate={{ scale: 2, opacity: 0 }}
                transition={{
                  duration: 1.5,
                  repeat: Infinity,
                  delay: i * 0.5,
                  ease: 'easeOut',
                }}
              />
            ))}
          </>
        )}
      </AnimatePresence>
      
      {/* Orbiting particles - Thinking */}
      <AnimatePresence>
        {state === 'thinking' && (
          <motion.div
            className="absolute"
            style={{ width: dimension, height: dimension }}
            animate={{ rotate: 360 }}
            transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
          >
            {Array.from({ length: 4 }).map((_, i) => (
              <motion.div
                key={`particle-${i}`}
                className="absolute w-3 h-3 rounded-full"
                style={{
                  backgroundColor: color,
                  top: '50%',
                  left: '50%',
                  marginTop: -6,
                  marginLeft: -6,
                  transform: `rotate(${i * 90}deg) translateX(${dimension * 0.4}px)`,
                  boxShadow: `0 0 10px ${color}`,
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.2 }}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Core orb */}
      <motion.div
        className="relative rounded-full"
        style={{
          width: dimension * 0.6,
          height: dimension * 0.6,
          background: `radial-gradient(circle at 30% 30%, ${color}40, ${color}20 50%, ${color}10)`,
          border: `2px solid ${color}`,
        }}
        animate={{
          scale: state === 'connecting' ? [1, 1.1, 1] : 1,
        }}
        transition={{
          scale: { duration: 1.5, repeat: state === 'connecting' ? Infinity : 0 },
        }}
      >
        {/* Inner glow */}
        <motion.div
          className="absolute inset-0 rounded-full"
          style={{
            background: `radial-gradient(circle at center, ${color}30, transparent 70%)`,
          }}
          animate={{
            opacity: state === 'idle' ? [0.5, 0.8, 0.5] : 0.6,
          }}
          transition={{
            opacity: { duration: 3, repeat: Infinity, ease: 'easeInOut' },
          }}
        />
        
        {/* Center bright spot */}
        <div 
          className="absolute rounded-full"
          style={{
            width: dimension * 0.15,
            height: dimension * 0.15,
            top: '25%',
            left: '25%',
            background: `radial-gradient(circle, white, ${color}80)`,
            filter: 'blur(2px)',
          }}
        />
      </motion.div>
      
      {/* State indicator dot (mini mode) */}
      {size === 'mini' && (
        <div 
          className="absolute bottom-0 right-0 w-4 h-4 rounded-full border-2 border-[var(--bg-primary)]"
          style={{ backgroundColor: color }}
        />
      )}
    </div>
  );
}

export default GeminiOrb;
