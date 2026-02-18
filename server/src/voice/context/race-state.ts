import { EventEmitter } from 'events';

/**
 * Proactive trigger types
 */
export interface ProactiveTrigger {
  type: 'flag_change' | 'position_change' | 'gap_delta' | 'incident' | 'session_change';
  priority: 'high' | 'medium' | 'low';
  cooldown: number;  // seconds
  message: string;   // brief description for LLM
  data?: any;        // additional context
}

/**
 * Race trends calculated from telemetry deltas
 */
interface RaceTrends {
  gapRate: number;           // s/lap to rival ahead (positive = losing time)
  fuelRate: number;          // liters/lap
  estimatedLapsRemaining: number;
  positionStable: boolean;
  tyreDegradation: number;   // 0-100% (estimated)
}

/**
 * RaceStateModule maintains race state and decides when to speak proactively
 */
export class RaceStateModule extends EventEmitter {
  private latestTelemetry: any = null;
  private prevTickTelemetry: any = null;

  private trends: RaceTrends = {
    gapRate: 0,
    fuelRate: 0,
    estimatedLapsRemaining: 0,
    positionStable: true,
    tyreDegradation: 0,
  };

  private proactiveCooldowns: Map<string, number> = new Map();
  private lastProactiveMessage: number = 0;

  private tickInterval: NodeJS.Timeout | null = null;
  private tickRate: number = 15000;  // 15s for race, will adjust for practice/quali

  private micEnabled: boolean = false;
  private vadActive: boolean = false;
  private ttsStreaming: boolean = false;

  constructor() {
    super();
  }

  /**
   * Start the ticker (periodic context updates to LLM)
   */
  public start(sessionType: 'race' | 'practice' | 'qualify'): void {
    // Adjust tick rate based on session type
    this.tickRate = sessionType === 'race' ? 15000 : 30000;

    if (this.tickInterval) {
      clearInterval(this.tickInterval);
    }

    console.log(`[RaceState] Starting ticker with ${this.tickRate}ms interval (${sessionType})`);
    console.log(`[RaceState] 🧠 LLM will receive periodic context and DECIDE if/when to speak`);

    this.tickInterval = setInterval(() => {
      this.tick();
    }, this.tickRate);
  }

  /**
   * Stop the ticker
   */
  public stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }

    console.log('[RaceState] Stopped ticker');
  }

  /**
   * Update telemetry from external source
   */
  public updateTelemetry(telemetry: any): void {
    this.prevTickTelemetry = this.latestTelemetry;
    this.latestTelemetry = telemetry;
  }

  /**
   * Notify session change (called when session_joined event is received)
   */
  public notifySessionChange(sessionData: any): void {
    console.log(`[RaceState] 🏁 Session change detected: ${sessionData.sessionType}`);

    // Emit session change event (high priority, LLM should give briefing)
    this.emit('sessionChange', {
      type: 'session_change',
      priority: 'high',
      message: '[NUEVA SESIÓN] Briefing inicial',
      data: sessionData,
    });
  }

  /**
   * Ticker: calculate trends and emit periodic context update
   *
   * The LLM receives this context and DECIDES if there's something worth saying.
   * No hardcoded rules here - the LLM is smart enough to judge what's important.
   */
  private tick(): void {
    if (!this.latestTelemetry || !this.prevTickTelemetry) {
      // Not enough data yet
      return;
    }

    // Calculate trends
    this.calculateTrends();

    // Emit periodic context update (LLM decides if it speaks)
    console.log(`[RaceState] 📊 Periodic context update (gap rate: ${this.trends.gapRate.toFixed(2)}s/lap, fuel: ${this.trends.estimatedLapsRemaining} laps)`);
    this.emit('periodicContext', {
      type: 'periodic_update',
      priority: 'low',
      message: '[CONTEXTO] Actualización periódica de estado',
      data: this.trends,
    });
  }

  /**
   * Calculate trends from telemetry deltas
   */
  private calculateTrends(): void {
    const curr = this.latestTelemetry;
    const prev = this.prevTickTelemetry;

    // Gap rate calculation (if we have rival ahead data)
    if (curr.rivals?.ahead && prev.rivals?.ahead) {
      const gapNow = curr.rivals.ahead.gap;
      const gapBefore = prev.rivals.ahead.gap;
      const lapDelta = (curr.lap?.currentLap || 0) - (prev.lap?.currentLap || 0);

      if (lapDelta > 0) {
        this.trends.gapRate = (gapNow - gapBefore) / lapDelta;
      }
    }

    // Fuel rate calculation
    if (curr.fuel?.level !== undefined && prev.fuel?.level !== undefined) {
      const fuelDelta = prev.fuel.level - curr.fuel.level;
      const lapDelta = (curr.lap?.currentLap || 0) - (prev.lap?.currentLap || 0);

      if (lapDelta > 0 && fuelDelta > 0) {
        this.trends.fuelRate = fuelDelta / lapDelta;

        // Estimated laps remaining
        if (this.trends.fuelRate > 0) {
          this.trends.estimatedLapsRemaining = Math.floor(curr.fuel.level / this.trends.fuelRate);
        }
      }
    }

    // Position stability
    const currPos = curr.standings?.position;
    const prevPos = prev.standings?.position;

    if (currPos !== undefined && prevPos !== undefined) {
      this.trends.positionStable = (currPos === prevPos);
    }

    // Tyre degradation (simple estimation based on lap count)
    // TODO: Improve with actual tyre data if available
    if (curr.tyres?.lapsSincePitStop !== undefined) {
      const lapsOnTyres = curr.tyres.lapsSincePitStop;
      // Rough estimation: 0% degradation at lap 1, 100% at lap 30
      this.trends.tyreDegradation = Math.min(100, (lapsOnTyres / 30) * 100);
    }
  }

  /**
   * Check for proactive triggers and return the highest priority one
   */
  private checkProactiveTriggers(): ProactiveTrigger | null {
    const triggers: ProactiveTrigger[] = [];

    // 1. Flag change (high priority, no cooldown)
    const flagTrigger = this.checkFlagChange();
    if (flagTrigger) triggers.push(flagTrigger);

    // 2. Incident (high priority, no cooldown)
    const incidentTrigger = this.checkIncident();
    if (incidentTrigger) triggers.push(incidentTrigger);

    // 3. Position change (medium priority, 30s cooldown)
    const positionTrigger = this.checkPositionChange();
    if (positionTrigger) triggers.push(positionTrigger);

    // 4. Gap delta (medium priority, 45s cooldown)
    const gapTrigger = this.checkGapDelta();
    if (gapTrigger) triggers.push(gapTrigger);

    // 5. Fuel critical (high priority, 60s cooldown)
    const fuelTrigger = this.checkFuelCritical();
    if (fuelTrigger) triggers.push(fuelTrigger);

    if (triggers.length === 0) {
      return null;
    }

    // Return highest priority trigger
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    triggers.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    const trigger = triggers[0];

    // Check if we should speak (not during conversation, not during TTS if low/medium priority)
    if (!this.shouldSpeak(trigger)) {
      console.log(`[RaceState] Suppressing trigger ${trigger.type} (mic: ${this.micEnabled}, vad: ${this.vadActive}, tts: ${this.ttsStreaming})`);
      return null;
    }

    return trigger;
  }

  /**
   * Check if flag changed (yellow, red, green)
   */
  private checkFlagChange(): ProactiveTrigger | null {
    if (!this.latestTelemetry?.session?.flag || !this.prevTickTelemetry?.session?.flag) {
      return null;
    }

    const currFlag = this.latestTelemetry.session.flag;
    const prevFlag = this.prevTickTelemetry.session.flag;

    if (currFlag !== prevFlag && currFlag !== 'green' && currFlag !== 'white') {
      return {
        type: 'flag_change',
        priority: 'high',
        cooldown: 0,
        message: `Flag changed to ${currFlag}`,
        data: { flag: currFlag },
      };
    }

    return null;
  }

  /**
   * Check for incidents (contact, spin, off-track)
   */
  private checkIncident(): ProactiveTrigger | null {
    // TODO: Implement incident detection when telemetry has this data
    // For now, return null (will be implemented based on actual telemetry format)
    return null;
  }

  /**
   * Check if position changed
   */
  private checkPositionChange(): ProactiveTrigger | null {
    if (!this.trends.positionStable) {
      if (this.isOnCooldown('position_change', 30)) {
        return null;
      }

      const currPos = this.latestTelemetry?.standings?.position;
      const prevPos = this.prevTickTelemetry?.standings?.position;

      if (currPos !== undefined && prevPos !== undefined) {
        const delta = currPos - prevPos;
        const direction = delta > 0 ? 'dropped' : 'gained';

        return {
          type: 'position_change',
          priority: 'medium',
          cooldown: 30,
          message: `Position ${direction} from P${prevPos} to P${currPos}`,
          data: { from: prevPos, to: currPos, delta },
        };
      }
    }

    return null;
  }

  /**
   * Check if gap rate is significant
   */
  private checkGapDelta(): ProactiveTrigger | null {
    const absGapRate = Math.abs(this.trends.gapRate);

    if (absGapRate > 0.5) {  // More than 0.5s/lap change
      if (this.isOnCooldown('gap_delta', 45)) {
        return null;
      }

      const direction = this.trends.gapRate > 0 ? 'losing' : 'gaining';

      return {
        type: 'gap_delta',
        priority: 'medium',
        cooldown: 45,
        message: `Gap ${direction} at ${absGapRate.toFixed(1)}s/lap`,
        data: { gapRate: this.trends.gapRate },
      };
    }

    return null;
  }

  /**
   * Check if fuel is critical
   */
  private checkFuelCritical(): ProactiveTrigger | null {
    if (this.trends.estimatedLapsRemaining > 0 && this.trends.estimatedLapsRemaining <= 3) {
      if (this.isOnCooldown('fuel_critical', 60)) {
        return null;
      }

      return {
        type: 'gap_delta',  // Reuse gap_delta type for now
        priority: 'high',
        cooldown: 60,
        message: `Fuel critical: ${this.trends.estimatedLapsRemaining} laps remaining`,
        data: { lapsRemaining: this.trends.estimatedLapsRemaining },
      };
    }

    return null;
  }

  /**
   * Check if trigger is on cooldown
   */
  private isOnCooldown(triggerType: string, cooldownSeconds: number): boolean {
    const lastTrigger = this.proactiveCooldowns.get(triggerType);
    if (!lastTrigger) {
      return false;
    }

    const elapsed = (Date.now() - lastTrigger) / 1000;
    return elapsed < cooldownSeconds;
  }

  /**
   * Record that a trigger fired
   */
  private recordProactiveTrigger(triggerType: string): void {
    this.proactiveCooldowns.set(triggerType, Date.now());
    this.lastProactiveMessage = Date.now();
  }

  /**
   * Should we speak now? (check mic/vad/tts state)
   */
  private shouldSpeak(trigger: ProactiveTrigger): boolean {
    // If mic is enabled and VAD detects voice, don't interrupt
    if (this.micEnabled && this.vadActive) {
      return false;
    }

    // If TTS is streaming, only speak for high priority
    if (this.ttsStreaming && trigger.priority !== 'high') {
      return false;
    }

    return true;
  }

  /**
   * Update mic/vad/tts state (called from outside)
   */
  public setMicEnabled(enabled: boolean): void {
    this.micEnabled = enabled;
  }

  public setVadActive(active: boolean): void {
    this.vadActive = active;
  }

  public setTTSStreaming(streaming: boolean): void {
    this.ttsStreaming = streaming;
  }

  /**
   * Get current state for LLM context
   */
  public getStateForLLM(): string {
    if (!this.latestTelemetry) {
      return '{}';
    }

    // Build compact JSON state
    const state = {
      session: {
        type: this.latestTelemetry.session?.type || 'unknown',
        flag: this.latestTelemetry.session?.flag || 'green',
        timeRemaining: this.latestTelemetry.session?.timeRemaining,
      },
      lap: {
        current: this.latestTelemetry.lap?.currentLap,
        total: this.latestTelemetry.lap?.totalLaps,
        lastTime: this.latestTelemetry.lap?.lastLapTime,
        bestTime: this.latestTelemetry.lap?.bestLapTime,
      },
      position: this.latestTelemetry.standings?.position,
      rivals: {
        ahead: this.latestTelemetry.rivals?.ahead
          ? {
              gap: this.latestTelemetry.rivals.ahead.gap,
              position: this.latestTelemetry.rivals.ahead.position,
            }
          : null,
        behind: this.latestTelemetry.rivals?.behind
          ? {
              gap: this.latestTelemetry.rivals.behind.gap,
              position: this.latestTelemetry.rivals.behind.position,
            }
          : null,
      },
      fuel: {
        level: this.latestTelemetry.fuel?.level,
        lapsRemaining: this.trends.estimatedLapsRemaining,
      },
      trends: {
        gapRate: this.trends.gapRate,
        fuelRate: this.trends.fuelRate,
        positionStable: this.trends.positionStable,
      },
    };

    return JSON.stringify(state, null, 0);  // Compact JSON
  }

  /**
   * Get latest telemetry (for external access)
   */
  public getLatestTelemetry(): any {
    return this.latestTelemetry;
  }

  /**
   * Get trends (for external access)
   */
  public getTrends(): RaceTrends {
    return { ...this.trends };
  }
}
