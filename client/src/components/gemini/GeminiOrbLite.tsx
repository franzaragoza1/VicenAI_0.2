/**
 * GeminiOrbLite - Lightweight version for overlay
 * ================================================
 * 
 * Optimized version of GeminiOrb that uses CSS animations instead of
 * Framer Motion to reduce CPU usage when hardware acceleration is disabled.
 * 
 * Designed specifically for the overlay window that runs over games.
 * 
 * States:
 * - disconnected: Gray, static
 * - connecting: Amber, CSS pulse
 * - idle: Cyan, subtle CSS breathing
 * - listening: Cyan, CSS ping animation
 * - thinking: Violet, CSS spin
 * - speaking: Green, CSS pulse outward
 */

import { useMemo } from 'react';

export type GeminiState = 
  | 'disconnected' 
  | 'connecting' 
  | 'idle' 
  | 'listening' 
  | 'thinking' 
  | 'speaking';

interface GeminiOrbLiteProps {
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

// CSS animation classes based on state
const animationClassMap: Record<GeminiState, string> = {
  disconnected: '',
  connecting: 'animate-pulse',
  idle: 'animate-breathe',
  listening: 'animate-ping-slow',
  thinking: 'animate-spin-slow',
  speaking: 'animate-pulse-out',
};

export function GeminiOrbLite({ state, size = 'mini', className = '' }: GeminiOrbLiteProps) {
  const dimension = sizeMap[size];
  const color = colorMap[state];
  const glow = glowMap[state];
  const animationClass = animationClassMap[state];
  
  // Memoize styles to prevent recalculation
  const orbStyle = useMemo(() => ({
    width: dimension * 0.6,
    height: dimension * 0.6,
    background: `radial-gradient(circle at 30% 30%, ${color}40, ${color}20 50%, ${color}10)`,
    border: `2px solid ${color}`,
    boxShadow: glow,
  }), [dimension, color, glow]);
  
  const innerGlowStyle = useMemo(() => ({
    background: `radial-gradient(circle at center, ${color}30, transparent 70%)`,
  }), [color]);
  
  const centerSpotStyle = useMemo(() => ({
    width: dimension * 0.15,
    height: dimension * 0.15,
    background: `radial-gradient(circle, white, ${color}80)`,
  }), [dimension, color]);
  
  const ringStyle = useMemo(() => ({
    width: dimension * 0.8,
    height: dimension * 0.8,
    borderColor: color,
  }), [dimension, color]);

  return (
    <div 
      className={`relative flex items-center justify-center ${className}`}
      style={{ width: dimension, height: dimension }}
    >
      {/* Animated ring for listening/speaking states - CSS only */}
      {(state === 'listening' || state === 'speaking') && (
        <div
          className={`absolute rounded-full border-2 opacity-50 ${
            state === 'listening' ? 'animate-ping-reverse' : 'animate-ping-slow'
          }`}
          style={ringStyle}
        />
      )}
      
      {/* Thinking indicator - simple rotating dots with CSS */}
      {state === 'thinking' && (
        <div 
          className="absolute animate-spin-slow"
          style={{ width: dimension, height: dimension }}
        >
          {[0, 90, 180, 270].map((rotation) => (
            <div
              key={rotation}
              className="absolute w-2 h-2 rounded-full"
              style={{
                backgroundColor: color,
                top: '50%',
                left: '50%',
                marginTop: -4,
                marginLeft: -4,
                transform: `rotate(${rotation}deg) translateX(${dimension * 0.35}px)`,
                boxShadow: `0 0 8px ${color}`,
              }}
            />
          ))}
        </div>
      )}
      
      {/* Core orb - static with CSS transitions for color changes */}
      <div
        className={`relative rounded-full transition-all duration-300 ${
          state === 'connecting' ? 'animate-pulse' : ''
        }`}
        style={orbStyle}
      >
        {/* Inner glow - static */}
        <div
          className="absolute inset-0 rounded-full opacity-60"
          style={innerGlowStyle}
        />
        
        {/* Center bright spot - static */}
        <div 
          className="absolute rounded-full blur-sm"
          style={{
            ...centerSpotStyle,
            top: '25%',
            left: '25%',
          }}
        />
      </div>
      
      {/* State indicator dot (mini mode) */}
      {size === 'mini' && (
        <div 
          className="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-gray-900 transition-colors duration-300"
          style={{ backgroundColor: color }}
        />
      )}
    </div>
  );
}

export default GeminiOrbLite;
