/**
 * FlagBanner - Active flag display
 * =================================
 * 
 * Shows currently active flags with appropriate colors.
 * Only visible when flags are active.
 */

import { motion, AnimatePresence } from 'framer-motion';
import { Flag, AlertTriangle } from 'lucide-react';

interface FlagBannerProps {
  flags: string[];
  className?: string;
}

const flagConfig: Record<string, { color: string; bgColor: string; pulse: boolean }> = {
  green: { color: '#00FF88', bgColor: 'rgba(0, 255, 136, 0.15)', pulse: false },
  yellow: { color: '#FFB800', bgColor: 'rgba(255, 184, 0, 0.15)', pulse: true },
  caution: { color: '#FFB800', bgColor: 'rgba(255, 184, 0, 0.15)', pulse: true },
  white: { color: '#FFFFFF', bgColor: 'rgba(255, 255, 255, 0.1)', pulse: false },
  blue: { color: '#3B82F6', bgColor: 'rgba(59, 130, 246, 0.15)', pulse: true },
  black: { color: '#FFFFFF', bgColor: 'rgba(0, 0, 0, 0.8)', pulse: false },
  red: { color: '#FF3B3B', bgColor: 'rgba(255, 59, 59, 0.2)', pulse: true },
  checkered: { color: '#FFFFFF', bgColor: 'rgba(255, 255, 255, 0.1)', pulse: false },
};

const flagLabels: Record<string, string> = {
  green: 'VERDE',
  yellow: 'AMARILLA',
  caution: 'CAUTION',
  white: 'BLANCA',
  blue: 'AZUL',
  black: 'NEGRA',
  red: 'ROJA',
  checkered: 'BANDERA A CUADROS',
};

export function FlagBanner({ flags, className = '' }: FlagBannerProps) {
  // Don't render if no flags or only "green"
  const activeFlags = flags.filter(f => f.toLowerCase() !== 'green' && f.toLowerCase() !== 'none');
  
  if (activeFlags.length === 0) {
    return null;
  }
  
  return (
    <AnimatePresence>
      <motion.div
        className={`flex flex-wrap gap-2 justify-center ${className}`}
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.2 }}
      >
        {activeFlags.map((flag) => {
          const flagKey = flag.toLowerCase();
          const config = flagConfig[flagKey] || { color: '#FFFFFF', bgColor: 'rgba(255,255,255,0.1)', pulse: false };
          const label = flagLabels[flagKey] || flag.toUpperCase();
          
          return (
            <motion.div
              key={flag}
              className="flex items-center gap-2 px-4 py-2 rounded-lg"
              style={{ 
                backgroundColor: config.bgColor,
                border: `1px solid ${config.color}40`,
              }}
              animate={config.pulse ? {
                opacity: [1, 0.7, 1],
                scale: [1, 1.02, 1],
              } : {}}
              transition={{ duration: 0.8, repeat: config.pulse ? Infinity : 0 }}
            >
              {flagKey === 'yellow' || flagKey === 'caution' ? (
                <AlertTriangle size={18} style={{ color: config.color }} />
              ) : (
                <Flag size={18} style={{ color: config.color }} />
              )}
              <span 
                className="text-sm font-bold tracking-wider"
                style={{ color: config.color }}
              >
                {label}
              </span>
            </motion.div>
          );
        })}
      </motion.div>
    </AnimatePresence>
  );
}

export default FlagBanner;
