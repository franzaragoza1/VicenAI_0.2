/**
 * Lap API Client
 * 
 * Frontend service to interact with the lap storage REST API.
 */

const API_BASE = 'http://localhost:8081/api';

export interface TelemetryPoint {
  distancePct: number;
  speed: number;
  throttle: number;
  brake: number;
  gear: number;
  rpm: number;
  steeringAngle: number;
}

export interface LapData {
  id: string;
  lapNumber: number;
  lapTime: number;
  isSessionBest: boolean;
  trackName: string;
  carName: string;
  completedAt: number;
  points: TelemetryPoint[];
  deltaToSessionBest: number;
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

export interface LapStats {
  totalLaps: number;
  sessionBestTime: number | null;
  sessionBestLapNumber: number | null;
}

export interface CurrentSession {
  trackName: string | null;
  trackConfig: string | null;
  carName: string | null;
}

export interface LapsResponse {
  laps: LapSummary[];
  stats: LapStats;
}

class LapApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE) {
    this.baseUrl = baseUrl;
  }

  /**
   * Get current session info (track + car)
   */
  async getCurrentSession(): Promise<CurrentSession> {
    try {
      const response = await fetch(`${this.baseUrl}/session/current`);
      if (!response.ok) {
        return { trackName: null, trackConfig: null, carName: null };
      }
      return response.json();
    } catch {
      return { trackName: null, trackConfig: null, carName: null };
    }
  }

  /**
   * Get all stored laps (summaries without full telemetry)
   * @param filter Optional filter by track and car
   */
  async getAllLaps(filter?: { track?: string; car?: string }): Promise<LapsResponse> {
    let url = `${this.baseUrl}/laps`;
    
    // Add filter params
    const params = new URLSearchParams();
    if (filter?.track) params.append('track', filter.track);
    if (filter?.car) params.append('car', filter.car);
    if (params.toString()) url += `?${params.toString()}`;
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch laps: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Get a specific lap by ID (full data with telemetry points)
   */
  async getLap(lapId: string): Promise<LapData> {
    const response = await fetch(`${this.baseUrl}/laps/${lapId}`);
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Lap ${lapId} not found`);
      }
      throw new Error(`Failed to fetch lap: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Get the session best lap
   */
  async getSessionBest(): Promise<LapData> {
    const response = await fetch(`${this.baseUrl}/laps/session-best`);
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('No session best lap recorded yet');
      }
      throw new Error(`Failed to fetch session best: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Get the last completed lap
   */
  async getLastLap(): Promise<LapData> {
    const response = await fetch(`${this.baseUrl}/laps/last`);
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('No laps recorded yet');
      }
      throw new Error(`Failed to fetch last lap: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Get a lap by reference: 'session_best', 'last', lap number, or ID
   * Returns null if not found (does not throw)
   */
  async getLapByReference(ref: string): Promise<LapData | null> {
    try {
      // Normalize reference
      const normalizedRef = ref.toLowerCase().replace('-', '_');
      
      if (normalizedRef === 'session_best') {
        return await this.getSessionBest();
      }
      
      if (normalizedRef === 'last') {
        return await this.getLastLap();
      }
      
      // Try as ID or lap number
      return await this.getLap(ref);
    } catch (error) {
      // Return null instead of throwing for 404s
      console.warn(`[LapApi] Lap not found for ref "${ref}":`, (error as Error).message);
      return null;
    }
  }

  /**
   * Delete a lap by ID
   */
  async deleteLap(lapId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/laps/${lapId}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      if (response.status === 400) {
        throw new Error('Cannot delete session best lap');
      }
      if (response.status === 404) {
        throw new Error(`Lap ${lapId} not found`);
      }
      throw new Error(`Failed to delete lap: ${response.statusText}`);
    }
  }

  /**
   * Reset all laps (new session)
   */
  async resetSession(): Promise<void> {
    const response = await fetch(`${this.baseUrl}/laps/reset`, {
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error(`Failed to reset session: ${response.statusText}`);
    }
  }

  /**
   * Format lap time as MM:SS.mmm
   */
  static formatLapTime(seconds: number): string {
    if (seconds <= 0) return '--:--.---';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toFixed(3).padStart(6, '0')}`;
  }

  /**
   * Format delta time as +/-X.XXX
   */
  static formatDelta(delta: number): string {
    if (delta === 0) return '--';
    const sign = delta > 0 ? '+' : '';
    return `${sign}${delta.toFixed(3)}`;
  }
}

// Singleton instance
export const lapApi = new LapApiClient();
