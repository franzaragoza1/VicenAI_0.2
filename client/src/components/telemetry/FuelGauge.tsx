/**
 * FuelGauge - Fuel level with laps remaining
 * ===========================================
 * 
 * Shows current fuel and estimated laps remaining.
 * Color-coded for urgency: normal > warning > critical.
 */

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Fuel } from 'lucide-react';

interface FuelGaugeProps {
  level: number;        // Current fuel in liters
  perLapAvg: number;    // Average consumption per lap
  className?: string;
}

type FuelState = 'normal' | 'warning' | 'critical';

export function FuelGauge({ level, perLapAvg, className = '' }: FuelGaugeProps) {
  const lapsRemaining = useMemo(() => {
    if (!perLapAvg || perLapAvg <= 0) return null;
    return Math.floor(level / perLapAvg);
  }, [level, perLapAvg]);
  
  const fuelState: FuelState = useMemo(() => {
    if (lapsRemaining === null) return 'normal';
    if (lapsRemaining <= 1) return 'critical';
    if (lapsRemaining <= 3) return 'warning';
    return 'normal';
  }, [lapsRemaining]);
  
  const getStateColor = (state: FuelState) => {
    switch (state) {
      case 'critical': return 'text-[var(--accent-red)]';
      case 'warning': return 'text-[var(--accent-amber)]';
      default: return 'text-[var(--text-primary)]';
    }
  };
  
  const getIconColor = (state: FuelState) => {
    switch (state) {
      case 'critical': return 'var(--accent-red)';
      case 'warning': return 'var(--accent-amber)';
      default: return 'var(--text-secondary)';
    }
  };
  
  return (
    <div className={`flex flex-col items-center ${className}`}>
      {/* Icon + Label */}
      <div className="flex items-center gap-1 mb-1">
        <motion.div
          animate={fuelState === 'critical' ? {
            scale: [1, 1.2, 1],
          } : {}}
          transition={{ duration: 0.5, repeat: fuelState === 'critical' ? Infinity : 0 }}
        >
          <Fuel 
            size={16} 
            style={{ color: getIconColor(fuelState) }}
          />
        </motion.div>
        <span className="text-[var(--text-muted)] text-xs uppercase tracking-wider">
          Fuel
        </span>
      </div>
      
      {/* Fuel level */}
      <motion.div
        className={`font-mono-numbers text-2xl font-semibold ${getStateColor(fuelState)}`}
        animate={fuelState === 'critical' ? {
          opacity: [1, 0.5, 1],
        } : {}}
        transition={{ duration: 0.8, repeat: fuelState === 'critical' ? Infinity : 0 }}
      >
        {level.toFixed(1)}L
      </motion.div>
      
      {/* Laps remaining */}
      {lapsRemaining !== null && (
        <span className={`text-xs mt-0.5 ${
          fuelState === 'critical' 
            ? 'text-[var(--accent-red)]' 
            : fuelState === 'warning'
              ? 'text-[var(--accent-amber)]'
              : 'text-[var(--text-muted)]'
        }`}>
          ~{lapsRemaining} {lapsRemaining === 1 ? 'vuelta' : 'vueltas'}
        </span>
      )}
    </div>
  );
}

export default FuelGauge;
