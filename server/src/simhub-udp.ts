/**
 * SimHub UDP Receiver
 * ===================
 * Receives rich telemetry data from SimHub plugin via UDP port 9999
 * 
 * SimHub provides calculated data that iRacing SDK doesn't expose:
 * - Sector times (S1, S2, S3)
 * - Accurate fuel remaining laps
 * - Spotter with exact distances
 * - Tire wear/temp per corner
 * - Opponent info with gaps
 */

import dgram from 'dgram';
import { EventEmitter } from 'events';

const SIMHUB_UDP_PORT = 9999;

// SimHub TelemetryPacket interface (matches your C# plugin)
export interface SimHubTelemetry {
  // Metadata
  timestamp: number;
  gameName: string;
  gameRunning: boolean;
  gamePaused: boolean;
  gameInMenu: boolean;
  gameReplay: boolean;
  spectating: boolean;

  // Track & Session
  trackName: string;
  trackCode: string;
  trackConfig: string;
  trackId: string;
  trackLength: number;
  reportedTrackLength: number;
  trackPositionPercent: number;
  trackPositionMeters: number;
  sessionTypeName: string;
  sessionTimeLeft: number;

  // Car ID
  carId: string;
  carModel: string;
  carClass: string;
  playerName: string;

  // Speed & RPM
  speedKmh: number;
  speedMph: number;
  speedLocal: number;
  rpms: number;
  maxRpm: number;
  redline: number;
  gear: string;

  // Inputs
  throttle: number;
  brake: number;
  clutch: number;

  // G-Forces
  accelerationSurge: number;
  accelerationSway: number;
  globalAccelerationG: number;

  // Tyres - Temperature (per corner, inner/middle/outer)
  tyreTemperatureFrontLeft: number;
  tyreTemperatureFrontRight: number;
  tyreTemperatureRearLeft: number;
  tyreTemperatureRearRight: number;
  tyreTemperatureFrontLeftInner: number;
  tyreTemperatureFrontLeftMiddle: number;
  tyreTemperatureFrontLeftOuter: number;
  tyreTemperatureFrontRightInner: number;
  tyreTemperatureFrontRightMiddle: number;
  tyreTemperatureFrontRightOuter: number;
  tyreTemperatureRearLeftInner: number;
  tyreTemperatureRearLeftMiddle: number;
  tyreTemperatureRearLeftOuter: number;
  tyreTemperatureRearRightInner: number;
  tyreTemperatureRearRightMiddle: number;
  tyreTemperatureRearRightOuter: number;
  tyresTemperatureAvg: number;

  // Tyres - Pressure
  tyrePressureFrontLeft: number;
  tyrePressureFrontRight: number;
  tyrePressureRearLeft: number;
  tyrePressureRearRight: number;
  tyrePressureUnit: string;

  // Tyres - Wear
  tyreWearFrontLeft: number;
  tyreWearFrontRight: number;
  tyreWearRearLeft: number;
  tyreWearRearRight: number;
  tyresWearAvg: number;
  tyresWearMax: number;
  lastLapTyreWearFrontLeft: number;
  lastLapTyreWearFrontRight: number;
  lastLapTyreWearRearLeft: number;
  lastLapTyreWearRearRight: number;

  // Brakes
  brakeTemperatureFrontLeft: number;
  brakeTemperatureFrontRight: number;
  brakeTemperatureRearLeft: number;
  brakeTemperatureRearRight: number;
  brakesTemperatureAvg: number;
  brakeBias: number;

  // Fuel - THE GOOD STUFF
  fuel: number;
  fuelRaw: number;
  fuelPercent: number;
  maxFuel: number;
  fuelUnit: string;
  estimatedFuelRemaingLaps: number;  // ✨ Already calculated by SimHub!
  instantConsumption_L100KM: number;

  // Environment
  airTemperature: number;
  roadTemperature: number;
  temperatureUnit: string;
  waterTemperature: number;
  oilTemperature: number;

  // Position & Laps
  position: number;
  playerLeaderboardPosition: number;
  currentLap: number;
  completedLaps: number;
  totalLaps: number;
  remainingLaps: number;

  // ⭐ SECTORS - What we were looking for!
  currentLapTime: number;
  lastLapTime: number;
  bestLapTime: number;
  allTimeBest: number;
  lastSectorTime: number;
  currentSectorIndex: number;
  sectorsCount: number;
  sector1Time: number;
  sector2Time: number;
  sector1LastLapTime: number;
  sector2LastLapTime: number;
  sector3LastLapTime: number;
  sector1BestTime: number;
  sector2BestTime: number;
  sector3BestTime: number;
  sector1BestLapTime: number;
  sector2BestLapTime: number;
  sector3BestLapTime: number;
  isLapValid: boolean;
  lapInvalidated: boolean;
  deltaToSessionBest: number;
  deltaToAllTimeBest: number;
  bestSplitDelta: number;

  // Damage
  carDamage1: number;
  carDamage2: number;
  carDamage3: number;
  carDamage4: number;
  carDamage5: number;
  carDamagesAvg: number;
  carDamagesMax: number;

  // TC & ABS
  tcActive: boolean;
  tcLevel: number;
  absActive: boolean;
  absLevel: number;

  // Flags
  flag_Name: string;
  flag_Yellow: boolean;
  flag_Blue: boolean;
  flag_White: boolean;
  flag_Black: boolean;
  flag_Green: boolean;
  flag_Checkered: boolean;
  flag_Orange: boolean;

  // Pit
  isInPit: boolean;
  isInPitLane: boolean;
  isInPitSince: number;
  pitLimiterOn: boolean;
  pitLimiterSpeed: number;
  lastPitStopDuration: number;

  // ⭐ SPOTTER - With exact distances!
  spotterCarLeft: boolean;
  spotterCarLeftAngle: number;
  spotterCarLeftDistance: number;
  spotterCarRight: boolean;
  spotterCarRightAngle: number;
  spotterCarRightDistance: number;

  // Opponents
  opponentsCount: number;
  playerClassOpponentsCount: number;
  hasMultipleClassOpponents: boolean;

  // ERS/DRS (F1, etc.)
  ersStored: number;
  ersMax: number;
  ersPercent: number;
  drsAvailable: boolean;
  drsEnabled: boolean;

  // Turbo
  turbo: number;
  turboPercent: number;

  // Misc
  draftEstimate: number;
  pushToPassActive: boolean;

  // iRacing Extra Properties
  iRacing_Player_iRating?: number;
  iRacing_Player_License?: string;
  iRacing_Player_SafetyRating?: string;
  iRacing_Player_CarNumber?: string;
  iRacing_Player_Position?: number;
  iRacing_Player_PositionInClass?: number;
  iRacing_Player_LapsSinceLastPit?: number;
  iRacing_FuelToAdd?: number;
  iRacing_FuelMaxFuelPerLap?: number;
  iRacing_SOF?: number;
  iRacing_TotalLaps?: number;
  iRacing_LapsRemaining?: number;
  iRacing_TrackTemperatureChange?: number;
  iRacing_AirTemperatureChange?: number;
  iRacing_PitWindowIsOpen?: boolean;
  iRacing_PitSpeedLimitKph?: number;
  iRacing_DistanceToPitEntry?: number;
  iRacing_CurrentSectorTime?: number;
  iRacing_CurrentSectorIndex?: number;
  iRacing_CurrentSectorBestTime?: number;
  iRacing_OptimalLapTime?: number;
  iRacing_Hybrid_SoC?: number;
  iRacing_Hybrid_Deploy?: number;
  iRacing_Hybrid_DeployMode?: string;
  iRacing_PushToPassCount?: number;
  iRacing_SessionBestLapTime?: number;

  // Opponent structures
  driverAhead_Global?: OpponentInfo;
  driverBehind_Global?: OpponentInfo;
  driverAhead_Class?: OpponentInfo;
  driverBehind_Class?: OpponentInfo;
  opponentAhead?: OpponentInfo;
  opponentBehind?: OpponentInfo;
  leader?: OpponentInfo;
  gapToLeader?: number;
}

export interface OpponentInfo {
  name: string;
  carNumber: string;
  carName: string;
  className: string;
  iRating: number;
  license: string;
  safetyRating: string;
  gap: number;
  lastLapTime: number;
  positionInClass: string;
  isInPit: boolean;
  tireCompound: string;
  isRelevant: boolean;
}

/**
 * SimHub UDP Receiver Service
 */
export class SimHubUDPReceiver extends EventEmitter {
  private server: dgram.Socket | null = null;
  private lastTelemetry: SimHubTelemetry | null = null;
  private isRunning = false;
  private packetCount = 0;
  private lastLogTime = 0;

  constructor() {
    super();
  }

  /**
   * Start listening for UDP packets from SimHub
   */
  start(): void {
    if (this.isRunning) {
      console.log('[SimHub UDP] Already running');
      return;
    }

    this.server = dgram.createSocket('udp4');

    this.server.on('error', (err) => {
      console.error(`[SimHub UDP] Error: ${err.message}`);
      this.server?.close();
      this.isRunning = false;
      
      // Try to restart after error
      setTimeout(() => this.start(), 5000);
    });

    this.server.on('message', (msg, rinfo) => {
      try {
        const data = JSON.parse(msg.toString()) as SimHubTelemetry;
        this.lastTelemetry = data;
        this.packetCount++;
        
        // Emit telemetry event
        this.emit('telemetry', data);
        
        // Log stats every 10 seconds
        const now = Date.now();
        if (now - this.lastLogTime > 10000) {
          this.lastLogTime = now;
          console.log(`[SimHub UDP] 📊 ${this.packetCount} packets | Game: ${data.gameName || 'Unknown'} | Track: ${data.trackName || 'N/A'}`);
        }
      } catch (error) {
        // Ignore parse errors (might be partial packets)
      }
    });

    this.server.on('listening', () => {
      const address = this.server!.address();
      console.log(`[SimHub UDP] ✅ Listening on ${address.address}:${address.port}`);
      this.isRunning = true;
    });

    this.server.bind(SIMHUB_UDP_PORT);
  }

  /**
   * Stop the UDP server
   */
  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
      this.isRunning = false;
      console.log('[SimHub UDP] Stopped');
    }
  }

  /**
   * Get the last received telemetry
   */
  getLastTelemetry(): SimHubTelemetry | null {
    return this.lastTelemetry;
  }

  /**
   * Check if receiving data
   */
  isActive(): boolean {
    return this.isRunning && this.lastTelemetry !== null;
  }
}

// Singleton instance
export const simhubReceiver = new SimHubUDPReceiver();
