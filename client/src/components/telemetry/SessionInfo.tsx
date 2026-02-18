/**
 * SessionInfo - Track and session details
 * ========================================
 * 
 * Shows current track, car, and session type.
 * Secondary information, displayed subtly.
 */

import { MapPin, Car, Timer } from 'lucide-react';

interface SessionInfoProps {
  trackName?: string;
  carName?: string;
  sessionType?: string;
  className?: string;
}

export function SessionInfo({ 
  trackName, 
  carName, 
  sessionType,
  className = '' 
}: SessionInfoProps) {
  if (!trackName && !carName && !sessionType) {
    return null;
  }
  
  return (
    <div className={`flex flex-wrap items-center justify-center gap-4 ${className}`}>
      {trackName && (
        <div className="flex items-center gap-1.5">
          <MapPin size={14} className="text-[var(--text-muted)]" />
          <span className="text-[var(--text-secondary)] text-sm">
            {trackName}
          </span>
        </div>
      )}
      
      {carName && (
        <div className="flex items-center gap-1.5">
          <Car size={14} className="text-[var(--text-muted)]" />
          <span className="text-[var(--text-secondary)] text-sm">
            {carName}
          </span>
        </div>
      )}
      
      {sessionType && (
        <div className="flex items-center gap-1.5">
          <Timer size={14} className="text-[var(--text-muted)]" />
          <span className="text-[var(--text-secondary)] text-sm capitalize">
            {sessionType}
          </span>
        </div>
      )}
    </div>
  );
}

export default SessionInfo;
