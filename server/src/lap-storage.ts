/**
 * Lap Storage Service - Node.js side
 * 
 * Receives completed laps from Python telemetry service via WebSocket
 * and exposes them via REST API for the frontend and Gemini tools.
 * 
 * Persists laps to JSON file for recovery after restarts.
 */

import * as fs from 'fs';
import * as path from 'path';

// Persistence file path
const DATA_DIR = path.join(process.cwd(), 'data');
const LAPS_FILE = path.join(DATA_DIR, 'laps.json');

export interface TelemetryPoint {
  distancePct: number;      // 0.0 - 1.0
  speed: number;            // km/h
  throttle: number;         // 0.0 - 1.0
  brake: number;            // 0.0 - 1.0
  gear: number;             // -1 to 8
  rpm: number;              // RPM
  steeringAngle: number;    // radians
}

export interface LapData {
  id: string;
  lapNumber: number;
  lapTime: number;                    // seconds
  isSessionBest: boolean;
  trackName: string;
  carName: string;
  completedAt: number;                // timestamp ms
  points: TelemetryPoint[];
  deltaToSessionBest: number;         // seconds
  pointCount?: number;                // For listings without full points
}

export interface LapSummary {
  id: string;
  lapNumber: number;
  lapTime: number;
  isSessionBest: boolean;
  trackName: string;
  carName: string;
  completedAt: number;
  deltaToSessionBest: number;
  pointCount: number;
}

class LapStorageService {
  private laps: Map<string, LapData> = new Map();
  private sessionBestId: string | null = null;
  private sessionBestTime: number = Infinity;
  private maxLaps: number;

  constructor(maxLaps: number = 10) {
    this.maxLaps = maxLaps;
    this.ensureDataDir();
    this.loadFromDisk();
    console.log('[LapStorage] Service initialized');
  }

  /**
   * Ensure data directory exists
   */
  private ensureDataDir(): void {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      console.log('[LapStorage] Created data directory:', DATA_DIR);
    }
  }

  /**
   * Load laps from disk on startup
   */
  private loadFromDisk(): void {
    try {
      if (fs.existsSync(LAPS_FILE)) {
        const data = JSON.parse(fs.readFileSync(LAPS_FILE, 'utf-8'));
        
        // Restore laps
        if (data.laps && Array.isArray(data.laps)) {
          for (const lap of data.laps) {
            this.laps.set(lap.id, lap);
          }
        }
        
        // Restore session best tracking
        this.sessionBestId = data.sessionBestId || null;
        this.sessionBestTime = data.sessionBestTime || Infinity;
        
        console.log(`[LapStorage] Loaded ${this.laps.size} laps from disk`);
        if (this.sessionBestId) {
          const best = this.laps.get(this.sessionBestId);
          if (best) {
            console.log(`[LapStorage] Session best: ${best.lapTime.toFixed(3)}s (Lap ${best.lapNumber})`);
          }
        }
      }
    } catch (error) {
      console.warn('[LapStorage] Could not load laps from disk:', error);
    }
  }

  /**
   * Save laps to disk (ASÍNCRONO - no bloquea el Event Loop)
   */
  private async saveToDisk(): Promise<void> {
    try {
      const data = {
        savedAt: new Date().toISOString(),
        sessionBestId: this.sessionBestId,
        sessionBestTime: this.sessionBestTime,
        laps: Array.from(this.laps.values()),
      };
      
      // CRÍTICO: Escritura asíncrona para no bloquear el Event Loop
      // JSON de 6MB+ bloqueaba el servidor con writeFileSync
      const tempFile = LAPS_FILE + '.tmp';
      await fs.promises.writeFile(tempFile, JSON.stringify(data, null, 2), 'utf-8');
      await fs.promises.rename(tempFile, LAPS_FILE);
      
      // Don't log on every save to reduce noise, only log count
      console.log(`[LapStorage] 💾 Saved ${this.laps.size} laps to disk (async)`);
    } catch (error) {
      console.error('[LapStorage] ❌ Failed to save laps to disk:', error);
    }
  }

  /**
   * Validate lap data before storing
   */
  private validateLap(lap: LapData): { valid: boolean; reason?: string } {
    // Check required fields
    if (!lap.id || typeof lap.id !== 'string') {
      return { valid: false, reason: 'Missing or invalid lap ID' };
    }
    if (typeof lap.lapNumber !== 'number' || lap.lapNumber < 1) {
      return { valid: false, reason: `Invalid lap number: ${lap.lapNumber}` };
    }
    if (typeof lap.lapTime !== 'number' || lap.lapTime < 10 || lap.lapTime > 1200) {
      return { valid: false, reason: `Invalid lap time: ${lap.lapTime}s (must be 10s-20min)` };
    }
    if (!lap.trackName || !lap.carName) {
      return { valid: false, reason: 'Missing track or car name' };
    }
    if (!lap.points || !Array.isArray(lap.points) || lap.points.length < 50) {
      return { valid: false, reason: `Insufficient telemetry points: ${lap.points?.length || 0}` };
    }
    return { valid: true };
  }

  /**
   * Store a lap received from Python telemetry service
   */
  storeLap(lap: LapData): void {
    // Validate before storing
    const validation = this.validateLap(lap);
    if (!validation.valid) {
      console.warn(`[LapStorage] ⚠️ Lap rejected: ${validation.reason}`);
      return;
    }

    // Update session best tracking
    if (lap.isSessionBest) {
      // Mark previous best as not best
      if (this.sessionBestId && this.laps.has(this.sessionBestId)) {
        const prevBest = this.laps.get(this.sessionBestId)!;
        prevBest.isSessionBest = false;
      }
      this.sessionBestId = lap.id;
      this.sessionBestTime = lap.lapTime;
      console.log(`[LapStorage] ⭐ New session best: ${lap.lapTime.toFixed(3)}s (Lap ${lap.lapNumber})`);
    }

    // Update delta for all laps
    if (this.sessionBestTime < Infinity) {
      lap.deltaToSessionBest = lap.lapTime - this.sessionBestTime;
    }

    this.laps.set(lap.id, lap);
    this.enforceLimit();
    
    // Persist to disk (fire-and-forget async, no bloquea)
    this.saveToDisk().catch(err => 
      console.error('[LapStorage] Save failed:', err)
    );
    
    console.log(`[LapStorage] ✅ Stored lap ${lap.lapNumber}: ${lap.lapTime.toFixed(3)}s (${lap.points?.length || 0} points)`);
  }

  /**
   * Process a lap_recorded event from Python
   */
  processLapRecordedEvent(lapEvent: {
    id: string;
    lapNumber: number;
    lapTime: number;
    isSessionBest: boolean;
    trackName: string;
    carName: string;
    pointCount: number;
    deltaToSessionBest: number;
  }, points?: TelemetryPoint[]): void {
    const lap: LapData = {
      ...lapEvent,
      completedAt: Date.now(),
      points: points || [],
    };
    this.storeLap(lap);
  }

  /**
   * Store full lap data with points (received via dedicated message)
   */
  storeFullLap(lapData: LapData): void {
    this.storeLap(lapData);
  }

  private enforceLimit(): void {
    while (this.laps.size > this.maxLaps) {
      // Find oldest lap that isn't session best
      let oldestId: string | null = null;
      let oldestTime = Infinity;

      for (const [id, lap] of this.laps) {
        if (id !== this.sessionBestId && lap.completedAt < oldestTime) {
          oldestTime = lap.completedAt;
          oldestId = id;
        }
      }

      if (oldestId) {
        this.laps.delete(oldestId);
        console.log(`[LapStorage] Removed old lap ${oldestId} to enforce limit`);
      } else {
        break;
      }
    }
  }

  /**
   * Get a specific lap by ID
   */
  getLap(lapId: string): LapData | undefined {
    return this.laps.get(lapId);
  }

  /**
   * Get lap by reference: 'session_best', 'last', or lap number
   */
  getLapByReference(ref: string): LapData | undefined {
    if (ref === 'session_best') {
      return this.getSessionBest();
    }
    if (ref === 'last') {
      return this.getLastLap();
    }
    // Try as lap number
    const lapNum = parseInt(ref, 10);
    if (!isNaN(lapNum)) {
      for (const lap of this.laps.values()) {
        if (lap.lapNumber === lapNum) {
          return lap;
        }
      }
    }
    // Try as ID
    return this.laps.get(ref);
  }

  /**
   * Get the session best lap
   */
  getSessionBest(): LapData | undefined {
    if (this.sessionBestId) {
      return this.laps.get(this.sessionBestId);
    }
    return undefined;
  }

  /**
   * Get the most recently completed lap
   */
  getLastLap(): LapData | undefined {
    let latest: LapData | undefined;
    let latestTime = 0;

    for (const lap of this.laps.values()) {
      if (lap.completedAt > latestTime) {
        latestTime = lap.completedAt;
        latest = lap;
      }
    }

    return latest;
  }

  /**
   * Get all laps as summaries (without full points data)
   */
  getAllLaps(): LapSummary[] {
    const result: LapSummary[] = [];

    for (const lap of this.laps.values()) {
      result.push({
        id: lap.id,
        lapNumber: lap.lapNumber,
        lapTime: lap.lapTime,
        isSessionBest: lap.isSessionBest,
        trackName: lap.trackName,
        carName: lap.carName,
        completedAt: lap.completedAt,
        deltaToSessionBest: lap.deltaToSessionBest,
        pointCount: lap.points?.length || 0,
      });
    }

    // Sort by completedAt descending (most recent first)
    result.sort((a, b) => b.completedAt - a.completedAt);
    return result;
  }

  /**
   * Delete a lap by ID (cannot delete session best)
   */
  deleteLap(lapId: string): boolean {
    if (lapId === this.sessionBestId) {
      console.warn('[LapStorage] Cannot delete session best lap');
      return false;
    }

    if (this.laps.has(lapId)) {
      this.laps.delete(lapId);
      this.saveToDisk().catch(err => 
        console.error('[LapStorage] Save after delete failed:', err)
      );
      console.log(`[LapStorage] Deleted lap ${lapId}`);
      return true;
    }

    return false;
  }

  /**
   * Clear all laps (new session)
   */
  resetSession(): void {
    this.laps.clear();
    this.sessionBestId = null;
    this.sessionBestTime = Infinity;
    this.saveToDisk().catch(err => 
      console.error('[LapStorage] Save after reset failed:', err)
    );
    console.log('[LapStorage] Session reset - all laps cleared');
  }

  /**
   * Get stats about stored laps
   */
  getStats(): {
    totalLaps: number;
    sessionBestTime: number | null;
    sessionBestLapNumber: number | null;
  } {
    const sessionBest = this.getSessionBest();
    return {
      totalLaps: this.laps.size,
      sessionBestTime: sessionBest?.lapTime ?? null,
      sessionBestLapNumber: sessionBest?.lapNumber ?? null,
    };
  }
}

// Singleton instance
export const lapStorage = new LapStorageService(10);
