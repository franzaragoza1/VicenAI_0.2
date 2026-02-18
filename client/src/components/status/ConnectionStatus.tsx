/**
 * ConnectionStatus - Service connection indicator
 * ================================================
 * 
 * Shows connection status for telemetry and Gemini services.
 * Minimal visual footprint when everything is connected.
 */

import { motion } from 'framer-motion';
import { Wifi, WifiOff, Radio } from 'lucide-react';

interface ConnectionStatusProps {
  telemetryConnected: boolean;
  geminiConnected: boolean;
  className?: string;
}

export function ConnectionStatus({ 
  telemetryConnected, 
  geminiConnected,
  className = '' 
}: ConnectionStatusProps) {
  const allConnected = telemetryConnected && geminiConnected;
  
  // When all connected, show minimal indicator
  if (allConnected) {
    return (
      <div className={`flex items-center gap-1.5 ${className}`}>
        <div className="w-2 h-2 rounded-full bg-[var(--accent-green)]" />
        <span className="text-[var(--text-muted)] text-xs">Online</span>
      </div>
    );
  }
  
  // Show detailed status when something is disconnected
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {/* Telemetry status */}
      <div className="flex items-center gap-1.5">
        {telemetryConnected ? (
          <Wifi size={14} className="text-[var(--accent-green)]" />
        ) : (
          <motion.div
            animate={{ opacity: [1, 0.5, 1] }}
            transition={{ duration: 1, repeat: Infinity }}
          >
            <WifiOff size={14} className="text-[var(--accent-red)]" />
          </motion.div>
        )}
        <span className={`text-xs ${
          telemetryConnected ? 'text-[var(--text-muted)]' : 'text-[var(--accent-red)]'
        }`}>
          {telemetryConnected ? 'Telemetry' : 'Sin telemetría'}
        </span>
      </div>
      
      {/* Gemini status */}
      <div className="flex items-center gap-1.5">
        {geminiConnected ? (
          <Radio size={14} className="text-[var(--accent-green)]" />
        ) : (
          <motion.div
            animate={{ opacity: [1, 0.5, 1] }}
            transition={{ duration: 1, repeat: Infinity }}
          >
            <Radio size={14} className="text-[var(--accent-amber)]" />
          </motion.div>
        )}
        <span className={`text-xs ${
          geminiConnected ? 'text-[var(--text-muted)]' : 'text-[var(--accent-amber)]'
        }`}>
          {geminiConnected ? 'Gemini' : 'Conectando Gemini...'}
        </span>
      </div>
    </div>
  );
}

export default ConnectionStatus;
