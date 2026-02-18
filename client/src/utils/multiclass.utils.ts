/**
 * Multiclass Racing Utilities
 * ============================
 * 
 * Helper functions for handling multiclass racing sessions.
 * Filters standings and context to only include drivers in the same class.
 */

import type { TelemetryData, StandingEntry } from '../types/telemetry.types';
import { formatTimeForGemini } from './telemetry.utils';

/**
 * Get the player's standing entry from telemetry
 */
export function getMyStanding(telemetry: TelemetryData): StandingEntry | null {
  if (!telemetry?.standings || telemetry.standings.length === 0) {
    return null;
  }

  const myPosition = telemetry.position?.overall;
  if (!myPosition) {
    return null;
  }

  // Find player's standing entry by overall position
  return telemetry.standings.find(s => s.position === myPosition) || null;
}

/**
 * Get the player's class name
 */
export function getMyClassName(telemetry: TelemetryData): string | null {
  const myStanding = getMyStanding(telemetry);
  return myStanding?.carClass || null;
}

/**
 * Get all standings filtered by the player's class, sorted by class position
 */
export function getClassStandings(telemetry: TelemetryData): StandingEntry[] {
  const myClassName = getMyClassName(telemetry);
  
  if (!myClassName || !telemetry?.standings || telemetry.standings.length === 0) {
    return [];
  }

  // Filter by class and sort by classPosition ascending
  return telemetry.standings
    .filter(s => s.carClass === myClassName)
    .sort((a, b) => a.classPosition - b.classPosition);
}

/**
 * Get the leader of the player's class
 */
export function getClassLeader(classStandings: StandingEntry[]): StandingEntry | null {
  if (!classStandings || classStandings.length === 0) {
    return null;
  }

  // Leader is the one with classPosition === 1
  return classStandings.find(s => s.classPosition === 1) || classStandings[0];
}

/**
 * Format standings table for Gemini with names, iRating, and times
 */
export function formatStandingsTableForGemini(
  standings: StandingEntry[],
  opts?: { limit?: number }
): string {
  if (!standings || standings.length === 0) {
    return 'No hay datos de clasificación';
  }

  const limit = opts?.limit || standings.length;
  const lines: string[] = [];

  // Header
  lines.push('Pos | # | Nombre | iRating | Licencia | Mejor Tiempo | Gap');
  lines.push('--- | - | ------ | ------- | -------- | ------------ | ---');

  // Rows
  const displayStandings = standings.slice(0, limit);
  for (const driver of displayStandings) {
    const pos = driver.classPosition || driver.position;
    const num = driver.carNumber || '?';
    const name = driver.userName || driver.name || '?';
    const bestTime = driver.fastestTime > 0 ? `${formatTimeForGemini(driver.fastestTime)}s` : 'N/A';
    const iRating = driver.iRating || 0;
    const license = driver.license || '?';
    const gap = driver.gapToLeader !== undefined && driver.gapToLeader > 0 
      ? `+${driver.gapToLeader.toFixed(1)}s` 
      : (driver.gapToLeader === 0 ? 'Líder' : '?');
    
    lines.push(`P${pos} | #${num} | ${name} | ${iRating} | ${license} | ${bestTime} | ${gap}`);
  }

  if (standings.length > limit) {
    lines.push(`... y ${standings.length - limit} más`);
  }

  return lines.join('\n');
}
