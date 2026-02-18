/**
 * GapIndicator - Gap to cars ahead/behind
 * ========================================
 * 
 * Shows gap in seconds with directional indicator.
 * Animates when gap changes significantly.
 */

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronUp, ChevronDown, Minus } from 'lucide-react';

interface GapIndicatorProps {
  label: 'ahead' | 'behind';
  gap: number; // seconds, positive = gap exists
  className?: string;
}

export function GapIndicator({ label, gap, className = '' }: GapIndicatorProps) {
  const prevGap = useRef(gap);
  const [trend, setTrend] = useState<'gaining' | 'losing' | 'stable'>('stable');
  
  useEffect(() => {
    const diff = gap - prevGap.current;
    const threshold = 0.05; // 50ms threshold to detect change
    
    if (label === 'ahead') {
      // Gap ahead: smaller = gaining, larger = losing
      if (diff < -threshold) setTrend('gaining');
      else if (diff > threshold) setTrend('losing');
      else setTrend('stable');
    } else {
      // Gap behind: smaller = they're gaining, larger = we're pulling away
      if (diff < -threshold) setTrend('losing');
      else if (diff > threshold) setTrend('gaining');
      else setTrend('stable');
    }
    
    prevGap.current = gap;
  }, [gap, label]);
  
  const formatGap = (seconds: number): string => {
    if (!seconds || seconds <= 0) return '---';
    if (seconds > 60) return '>60s';
    return seconds.toFixed(1) + 's';
  };
  
  const getTrendColor = () => {
    if (trend === 'gaining') return 'text-[var(--accent-green)]';
    if (trend === 'losing') return 'text-[var(--accent-red)]';
    return 'text-[var(--text-primary)]';
  };
  
  const TrendIcon = () => {
    if (trend === 'gaining') return <ChevronUp className="w-4 h-4 text-[var(--accent-green)]" />;
    if (trend === 'losing') return <ChevronDown className="w-4 h-4 text-[var(--accent-red)]" />;
    return <Minus className="w-4 h-4 text-[var(--text-muted)]" />;
  };
  
  return (
    <div className={`flex flex-col items-center ${className}`}>
      {/* Label */}
      <span className="text-[var(--text-muted)] text-xs uppercase tracking-wider mb-1">
        {label === 'ahead' ? 'Adelante' : 'Atrás'}
      </span>
      
      {/* Gap value with trend */}
      <div className="flex items-center gap-1">
        <TrendIcon />
        <motion.span
          key={gap.toFixed(1)}
          className={`font-mono-numbers text-2xl font-semibold ${getTrendColor()}`}
          initial={{ scale: 1.1 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        >
          {formatGap(gap)}
        </motion.span>
      </div>
    </div>
  );
}

export default GapIndicator;
