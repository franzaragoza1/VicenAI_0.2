/**
 * MicIndicator - PTT/Microphone status indicator
 * ===============================================
 * 
 * Shows whether the microphone is active (PTT pressed).
 * Only visible when mic is active to avoid clutter.
 */

import { motion, AnimatePresence } from 'framer-motion';
import { Mic, MicOff } from 'lucide-react';

interface MicIndicatorProps {
  isActive: boolean;
  showWhenInactive?: boolean;
  size?: 'small' | 'medium';
  className?: string;
}

export function MicIndicator({ 
  isActive, 
  showWhenInactive = false, 
  size = 'medium',
  className = '' 
}: MicIndicatorProps) {
  const iconSize = size === 'small' ? 16 : 20;
  
  // Don't render if inactive and we don't want to show inactive state
  if (!isActive && !showWhenInactive) {
    return null;
  }
  
  return (
    <AnimatePresence>
      <motion.div
        className={`flex items-center gap-2 ${className}`}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.2 }}
      >
        <motion.div
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${
            isActive 
              ? 'bg-[var(--accent-cyan)]/20 border border-[var(--accent-cyan)]/50' 
              : 'bg-[var(--bg-elevated)] border border-[var(--text-muted)]/30'
          }`}
          animate={isActive ? {
            boxShadow: [
              '0 0 0px rgba(0, 217, 255, 0)',
              '0 0 20px rgba(0, 217, 255, 0.3)',
              '0 0 0px rgba(0, 217, 255, 0)',
            ],
          } : {}}
          transition={{ duration: 1.5, repeat: Infinity }}
        >
          {isActive ? (
            <Mic 
              size={iconSize} 
              className="text-[var(--accent-cyan)]" 
            />
          ) : (
            <MicOff 
              size={iconSize} 
              className="text-[var(--text-muted)]" 
            />
          )}
          
          <span className={`text-sm font-medium ${
            isActive ? 'text-[var(--accent-cyan)]' : 'text-[var(--text-muted)]'
          }`}>
            {isActive ? 'LIVE' : 'PTT'}
          </span>
          
          {/* Animated bars when active */}
          {isActive && (
            <div className="flex items-end gap-0.5 h-4">
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  className="w-1 bg-[var(--accent-cyan)] rounded-full"
                  animate={{
                    height: ['40%', '100%', '60%', '80%', '40%'],
                  }}
                  transition={{
                    duration: 0.8,
                    repeat: Infinity,
                    delay: i * 0.1,
                  }}
                />
              ))}
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export default MicIndicator;
