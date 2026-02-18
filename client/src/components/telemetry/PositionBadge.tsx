/**
 * PositionBadge - Race position display
 * ======================================
 * 
 * Large, glanceable position indicator.
 * Shows P3 / 20 format with class position if different.
 */

import { motion } from 'framer-motion';

interface PositionBadgeProps {
  position: number;
  totalCars: number;
  classPosition?: number;
  className?: string;
}

export function PositionBadge({ 
  position, 
  totalCars, 
  classPosition,
  className = '' 
}: PositionBadgeProps) {
  const showClassPosition = classPosition && classPosition !== position;
  
  // Position color coding
  const getPositionColor = (pos: number) => {
    if (pos === 1) return 'text-[var(--accent-amber)]'; // Gold for P1
    if (pos <= 3) return 'text-[var(--accent-green)]';  // Green for podium
    return 'text-[var(--text-primary)]';
  };
  
  return (
    <div className={`flex flex-col items-center ${className}`}>
      {/* Main position */}
      <div className="flex items-baseline gap-1">
        <span className="text-[var(--text-muted)] text-lg">P</span>
        <motion.span
          key={position}
          className={`font-mono-numbers text-5xl font-bold ${getPositionColor(position)}`}
          initial={{ scale: 1.2, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        >
          {position}
        </motion.span>
        <span className="text-[var(--text-muted)] text-lg">
          /{totalCars}
        </span>
      </div>
      
      {/* Class position (if multiclass) */}
      {showClassPosition && (
        <div className="flex items-center gap-1 mt-1">
          <span className="text-[var(--text-muted)] text-xs">Clase:</span>
          <span className="text-[var(--accent-cyan)] text-sm font-medium">
            P{classPosition}
          </span>
        </div>
      )}
    </div>
  );
}

export default PositionBadge;
