/**
 * RacingLayout - Main dashboard layout
 * =====================================
 * 
 * Three-zone layout optimized for glanceability:
 * 1. Hero Zone (40%): Gemini state - the main focus
 * 2. Glance Zone (35%): Critical data - position, gaps, fuel
 * 3. Detail Zone (25%): Secondary info - session, flags
 */

import { ReactNode } from 'react';

interface RacingLayoutProps {
  heroContent: ReactNode;
  glanceContent: ReactNode;
  detailContent?: ReactNode;
  topBar?: ReactNode;
  className?: string;
}

export function RacingLayout({ 
  heroContent, 
  glanceContent, 
  detailContent,
  topBar,
  className = '' 
}: RacingLayoutProps) {
  return (
    <div className={`h-full w-full flex flex-col bg-[var(--bg-primary)] ${className}`}>
      {/* Top bar (connection status, etc.) */}
      {topBar && (
        <div className="flex-shrink-0 px-4 py-2 border-b border-white/5">
          {topBar}
        </div>
      )}
      
      {/* Main content */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* Hero Zone - Gemini State (40%) */}
        <div className="flex-[4] flex items-center justify-center p-4">
          {heroContent}
        </div>
        
        {/* Glance Zone - Critical Data (35%) */}
        <div className="flex-[3.5] flex items-center justify-center px-4 py-2 border-t border-white/5">
          {glanceContent}
        </div>
        
        {/* Detail Zone - Secondary Info (25%) */}
        {detailContent && (
          <div className="flex-[2.5] flex items-center justify-center px-4 py-2 border-t border-white/5 bg-[var(--bg-surface)]">
            {detailContent}
          </div>
        )}
      </div>
    </div>
  );
}

export default RacingLayout;
