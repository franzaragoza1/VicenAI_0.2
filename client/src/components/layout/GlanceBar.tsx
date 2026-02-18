/**
 * GlanceBar - Critical telemetry data bar
 * ========================================
 * 
 * Displays position, gaps, and fuel in a horizontal layout.
 * Designed for quick glances at 60-80cm distance.
 */

import { PositionBadge } from '../telemetry/PositionBadge';
import { GapIndicator } from '../telemetry/GapIndicator';
import { FuelGauge } from '../telemetry/FuelGauge';

interface GlanceBarProps {
  position: number;
  totalCars: number;
  classPosition?: number;
  gapAhead: number;
  gapBehind: number;
  fuelLevel: number;
  fuelPerLap: number;
  className?: string;
}

export function GlanceBar({
  position,
  totalCars,
  classPosition,
  gapAhead,
  gapBehind,
  fuelLevel,
  fuelPerLap,
  className = ''
}: GlanceBarProps) {
  return (
    <div className={`flex items-center justify-center gap-8 md:gap-12 lg:gap-16 ${className}`}>
      {/* Gap Ahead */}
      <GapIndicator 
        label="ahead" 
        gap={gapAhead} 
      />
      
      {/* Position - Center and largest */}
      <PositionBadge
        position={position}
        totalCars={totalCars}
        classPosition={classPosition}
      />
      
      {/* Gap Behind */}
      <GapIndicator 
        label="behind" 
        gap={gapBehind} 
      />
      
      {/* Divider */}
      <div className="w-px h-12 bg-white/10" />
      
      {/* Fuel */}
      <FuelGauge
        level={fuelLevel}
        perLapAvg={fuelPerLap}
      />
    </div>
  );
}

export default GlanceBar;
