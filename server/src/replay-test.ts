import dgram from 'dgram';

interface TelemetryFrame {
  Speed: number;
  CurrentLapTimeMs: number;
  LastLapTimeMs: number;
  BestLapTimeMs: number;
  Sector1TimeMs: number;
  Sector2TimeMs: number;
  Sector3TimeMs: number;
  Sector1LastLapTime?: number;
  Sector2LastLapTime?: number;
  Sector3LastLapTime?: number;
  Sector1BestLapTime?: number;
  Sector2BestLapTime?: number;
  Sector3BestLapTime?: number;
  TrackPositionPercent: number;
  Position: number;
  CompletedLaps: number;
  RemainingLaps: number;
  SessionTimeLeft: number;
  GapToPlayerAhead: number;
  GapToPlayerBehind: number;
  SessionTypeName: string;
  TrackDisplayName: string;
  CarName: string;
  TrackStatus: string;
  IsOnPitRoad: boolean;
  SpotterCarLeft: boolean;
  SpotterCarRight: boolean;
  Flag_Yellow: number;
  Flag_Blue: number;
  Flag_Green: number;
  Flag_White: number;
  Flag_Checkered: number;
  Flag_Black: number;
  FuelLevel: number;
  MaxFuel: number;
  CarDamagePercent: number;
  OpponentsAheadOnTrack?: Array<{
    Name: string;
    CompletedLaps: number;
    Speed: number;
    GapToPlayer: number;
    TrackPositionPercent: number;
    Position: number;
  }>;
  OpponentsBehindOnTrack?: Array<{
    Name: string;
    CompletedLaps: number;
    Speed: number;
    GapToPlayer: number;
    TrackPositionPercent: number;
    Position: number;
  }>;
  TrackTemp?: number;
  AirTemp?: number;
  ReportedTrackLength?: number;
}

const createBaseFrame = (overrides: Partial<TelemetryFrame> = {}): TelemetryFrame => ({
  Speed: 180,
  CurrentLapTimeMs: 85000,
  LastLapTimeMs: 87500,
  BestLapTimeMs: 86200,
  Sector1TimeMs: 28000,
  Sector2TimeMs: 29500,
  Sector3TimeMs: 30000,
  Sector1LastLapTime: 28000,
  Sector2LastLapTime: 29500,
  Sector3LastLapTime: 30000,
  Sector1BestLapTime: 27800,
  Sector2BestLapTime: 29200,
  Sector3BestLapTime: 29500,
  TrackPositionPercent: 35.0,
  Position: 5,
  CompletedLaps: 10,
  RemainingLaps: 15,
  SessionTimeLeft: 900,
  GapToPlayerAhead: 2.5,
  GapToPlayerBehind: 1.8,
  SessionTypeName: 'Race',
  TrackDisplayName: 'Spa-Francorchamps',
  CarName: 'Porsche 911 GT3 R',
  TrackStatus: '',
  IsOnPitRoad: false,
  SpotterCarLeft: false,
  SpotterCarRight: false,
  Flag_Yellow: 0,
  Flag_Blue: 0,
  Flag_Green: 1,
  Flag_White: 0,
  Flag_Checkered: 0,
  Flag_Black: 0,
  FuelLevel: 54,
  MaxFuel: 120,
  CarDamagePercent: 0,
  OpponentsAheadOnTrack: [
    { Name: 'Hamilton', CompletedLaps: 10, Speed: 185, GapToPlayer: -2.5, TrackPositionPercent: 37.0, Position: 4 },
    { Name: 'Leclerc', CompletedLaps: 10, Speed: 188, GapToPlayer: -5.2, TrackPositionPercent: 45.0, Position: 3 },
    { Name: 'Sainz', CompletedLaps: 10, Speed: 190, GapToPlayer: -8.5, TrackPositionPercent: 55.0, Position: 2 },
    { Name: 'Norris', CompletedLaps: 10, Speed: 192, GapToPlayer: -12.0, TrackPositionPercent: 65.0, Position: 1 }
  ],
  OpponentsBehindOnTrack: [
    { Name: 'Verstappen', CompletedLaps: 10, Speed: 178, GapToPlayer: 1.8, TrackPositionPercent: 33.0, Position: 6 },
    { Name: 'Alonso', CompletedLaps: 10, Speed: 175, GapToPlayer: 4.5, TrackPositionPercent: 28.0, Position: 7 }
  ],
  TrackTemp: 28,
  AirTemp: 22,
  ReportedTrackLength: 7004,
  ...overrides
});


const scenarios = [
  // ============================================================================
  // PRESSURE EVENTS: HELD_UP & PRESSURED
  // ============================================================================
  {
    name: 'HELD_UP: CLOSE_AHEAD sostenido 60s',
    description: 'Gap delante < 1.0s durante 60+ segundos → HELD_UP event',
    frameInterval: 2000, // 2s entre frames = 30 frames = 60s total
    frames: Array.from({ length: 30 }, (_, i) => 
      createBaseFrame({ 
        GapToPlayerAhead: 0.7 + (Math.random() * 0.2 - 0.1), // 0.6-0.8s (CLOSE)
        CompletedLaps: 5 + Math.floor(i / 10),
        OpponentsAheadOnTrack: [
          { Name: 'Hamilton', CompletedLaps: 5 + Math.floor(i / 10), Speed: 175, GapToPlayer: -0.7, TrackPositionPercent: 37.0, Position: 4 }
        ]
      })
    )
  },
  {
    name: 'PRESSURED: CLOSE_BEHIND sostenido 60s',
    description: 'Gap detrás < 1.0s durante 60+ segundos → PRESSURED event',
    frameInterval: 2000,
    frames: Array.from({ length: 30 }, (_, i) => 
      createBaseFrame({ 
        GapToPlayerBehind: 0.6 + (Math.random() * 0.2 - 0.1), // 0.5-0.7s (CLOSE)
        CompletedLaps: 8 + Math.floor(i / 10),
        OpponentsBehindOnTrack: [
          { Name: 'Verstappen', CompletedLaps: 8 + Math.floor(i / 10), Speed: 185, GapToPlayer: 0.6, TrackPositionPercent: 33.0, Position: 6 }
        ]
      })
    )
  },

  // ============================================================================
  // GAP_TREND EVENTS: INCREASING & DECREASING
  // ============================================================================
  {
    name: 'GAP_TREND: DECREASING (ahead)',
    description: 'Gap al coche delante se reduce progresivamente → GAP_TREND_WARNING',
    frameInterval: 2000,
    frames: [
      createBaseFrame({ GapToPlayerAhead: 3.5, CompletedLaps: 10 }),
      createBaseFrame({ GapToPlayerAhead: 3.2, CompletedLaps: 10 }),
      createBaseFrame({ GapToPlayerAhead: 2.9, CompletedLaps: 11 }),
      createBaseFrame({ GapToPlayerAhead: 2.6, CompletedLaps: 11 }),
      createBaseFrame({ GapToPlayerAhead: 2.3, CompletedLaps: 11 }),
      createBaseFrame({ GapToPlayerAhead: 2.0, CompletedLaps: 12 }),
      createBaseFrame({ GapToPlayerAhead: 1.7, CompletedLaps: 12 }),
      createBaseFrame({ GapToPlayerAhead: 1.4, CompletedLaps: 12 })
    ]
  },
  {
    name: 'GAP_TREND: INCREASING (behind)',
    description: 'El coche detrás se aleja → GAP_TREND_WARNING',
    frameInterval: 2000,
    frames: [
      createBaseFrame({ GapToPlayerBehind: 1.2, CompletedLaps: 12 }),
      createBaseFrame({ GapToPlayerBehind: 1.5, CompletedLaps: 12 }),
      createBaseFrame({ GapToPlayerBehind: 1.8, CompletedLaps: 13 }),
      createBaseFrame({ GapToPlayerBehind: 2.1, CompletedLaps: 13 }),
      createBaseFrame({ GapToPlayerBehind: 2.4, CompletedLaps: 13 }),
      createBaseFrame({ GapToPlayerBehind: 2.7, CompletedLaps: 14 }),
      createBaseFrame({ GapToPlayerBehind: 3.0, CompletedLaps: 14 }),
      createBaseFrame({ GapToPlayerBehind: 3.3, CompletedLaps: 14 })
    ]
  },

  // ============================================================================
  // POSITION EVENTS: OVERTAKE & BEING_OVERTAKEN
  // ============================================================================
  {
    name: 'OVERTAKE: Adelantamiento confirmado',
    description: 'Player adelanta a Hamilton: P5→P4 con rival cambiando de ahead a behind',
    frameInterval: 2000,
    frames: [
      // Antes: Hamilton delante (P4), player P5
      createBaseFrame({ 
        Position: 5, 
        GapToPlayerAhead: 0.8,
        OpponentsAheadOnTrack: [
          { Name: 'Hamilton', CompletedLaps: 15, Speed: 175, GapToPlayer: -0.8, TrackPositionPercent: 37.0, Position: 4 }
        ],
        OpponentsBehindOnTrack: [
          { Name: 'Verstappen', CompletedLaps: 15, Speed: 172, GapToPlayer: 2.5, TrackPositionPercent: 30.0, Position: 6 }
        ],
        CompletedLaps: 15
      }),
      createBaseFrame({ 
        Position: 5, 
        GapToPlayerAhead: 0.5,
        OpponentsAheadOnTrack: [
          { Name: 'Hamilton', CompletedLaps: 15, Speed: 173, GapToPlayer: -0.5, TrackPositionPercent: 38.0, Position: 4 }
        ],
        OpponentsBehindOnTrack: [
          { Name: 'Verstappen', CompletedLaps: 15, Speed: 172, GapToPlayer: 2.7, TrackPositionPercent: 30.5, Position: 6 }
        ],
        CompletedLaps: 15
      }),
      // Momento del adelantamiento
      createBaseFrame({ 
        Position: 4, 
        GapToPlayerAhead: 2.0,
        GapToPlayerBehind: 0.2,
        OpponentsAheadOnTrack: [
          { Name: 'Leclerc', CompletedLaps: 15, Speed: 180, GapToPlayer: -2.0, TrackPositionPercent: 42.0, Position: 3 }
        ],
        OpponentsBehindOnTrack: [
          { Name: 'Hamilton', CompletedLaps: 15, Speed: 170, GapToPlayer: 0.2, TrackPositionPercent: 39.5, Position: 5 },
          { Name: 'Verstappen', CompletedLaps: 15, Speed: 172, GapToPlayer: 3.0, TrackPositionPercent: 31.0, Position: 6 }
        ],
        CompletedLaps: 15
      }),
      // Confirmación: 3+ frames con Hamilton detrás
      createBaseFrame({ 
        Position: 4, 
        GapToPlayerBehind: 0.4,
        OpponentsAheadOnTrack: [
          { Name: 'Leclerc', CompletedLaps: 15, Speed: 180, GapToPlayer: -2.2, TrackPositionPercent: 43.0, Position: 3 }
        ],
        OpponentsBehindOnTrack: [
          { Name: 'Hamilton', CompletedLaps: 15, Speed: 170, GapToPlayer: 0.4, TrackPositionPercent: 40.0, Position: 5 }
        ],
        CompletedLaps: 15
      }),
      createBaseFrame({ 
        Position: 4, 
        GapToPlayerBehind: 0.6,
        OpponentsAheadOnTrack: [
          { Name: 'Leclerc', CompletedLaps: 15, Speed: 180, GapToPlayer: -2.4, TrackPositionPercent: 44.0, Position: 3 }
        ],
        OpponentsBehindOnTrack: [
          { Name: 'Hamilton', CompletedLaps: 15, Speed: 170, GapToPlayer: 0.6, TrackPositionPercent: 40.5, Position: 5 }
        ],
        CompletedLaps: 15
      }),
      createBaseFrame({ 
        Position: 4, 
        GapToPlayerBehind: 0.8,
        OpponentsAheadOnTrack: [
          { Name: 'Leclerc', CompletedLaps: 15, Speed: 180, GapToPlayer: -2.6, TrackPositionPercent: 45.0, Position: 3 }
        ],
        OpponentsBehindOnTrack: [
          { Name: 'Hamilton', CompletedLaps: 15, Speed: 170, GapToPlayer: 0.8, TrackPositionPercent: 41.0, Position: 5 }
        ],
        CompletedLaps: 16
      })
    ]
  },
  {
    name: 'BEING_OVERTAKEN: Ser adelantado',
    description: 'Verstappen adelanta al player: P5→P6 con rival cambiando de behind a ahead',
    frameInterval: 2000,
    frames: [
      // Antes: Verstappen detrás (P6), player P5
      createBaseFrame({ 
        Position: 5, 
        GapToPlayerBehind: 0.9,
        OpponentsAheadOnTrack: [
          { Name: 'Hamilton', CompletedLaps: 18, Speed: 185, GapToPlayer: -2.0, TrackPositionPercent: 40.0, Position: 4 }
        ],
        OpponentsBehindOnTrack: [
          { Name: 'Verstappen', CompletedLaps: 18, Speed: 188, GapToPlayer: 0.9, TrackPositionPercent: 33.0, Position: 6 }
        ],
        CompletedLaps: 18
      }),
      createBaseFrame({ 
        Position: 5, 
        GapToPlayerBehind: 0.5,
        OpponentsAheadOnTrack: [
          { Name: 'Hamilton', CompletedLaps: 18, Speed: 185, GapToPlayer: -2.2, TrackPositionPercent: 41.0, Position: 4 }
        ],
        OpponentsBehindOnTrack: [
          { Name: 'Verstappen', CompletedLaps: 18, Speed: 190, GapToPlayer: 0.5, TrackPositionPercent: 34.5, Position: 6 }
        ],
        CompletedLaps: 18
      }),
      // Momento del adelantamiento
      createBaseFrame({ 
        Position: 6, 
        GapToPlayerAhead: 0.2,
        GapToPlayerBehind: 3.5,
        OpponentsAheadOnTrack: [
          { Name: 'Verstappen', CompletedLaps: 18, Speed: 192, GapToPlayer: -0.2, TrackPositionPercent: 36.0, Position: 5 },
          { Name: 'Hamilton', CompletedLaps: 18, Speed: 185, GapToPlayer: -2.5, TrackPositionPercent: 42.0, Position: 4 }
        ],
        OpponentsBehindOnTrack: [
          { Name: 'Alonso', CompletedLaps: 18, Speed: 175, GapToPlayer: 3.5, TrackPositionPercent: 28.0, Position: 7 }
        ],
        CompletedLaps: 18
      }),
      // Confirmación: 3+ frames con Verstappen delante
      createBaseFrame({ 
        Position: 6, 
        GapToPlayerAhead: 0.4,
        OpponentsAheadOnTrack: [
          { Name: 'Verstappen', CompletedLaps: 18, Speed: 192, GapToPlayer: -0.4, TrackPositionPercent: 37.0, Position: 5 }
        ],
        CompletedLaps: 18
      }),
      createBaseFrame({ 
        Position: 6, 
        GapToPlayerAhead: 0.6,
        OpponentsAheadOnTrack: [
          { Name: 'Verstappen', CompletedLaps: 18, Speed: 192, GapToPlayer: -0.6, TrackPositionPercent: 38.0, Position: 5 }
        ],
        CompletedLaps: 18
      }),
      createBaseFrame({ 
        Position: 6, 
        GapToPlayerAhead: 0.8,
        OpponentsAheadOnTrack: [
          { Name: 'Verstappen', CompletedLaps: 18, Speed: 192, GapToPlayer: -0.8, TrackPositionPercent: 39.0, Position: 5 }
        ],
        CompletedLaps: 19
      })
    ]
  },

  // ============================================================================
  // LAP TIME EVENTS: CONSISTENCY
  // ============================================================================
  {
    name: 'CONSISTENCY: 6 vueltas con mejora progresiva',
    description: 'Tiempos de vuelta mejorando → CONSISTENT performance',
    frameInterval: 3000, // 3s entre frames para simular vueltas
    frames: [
      createBaseFrame({ LastLapTimeMs: 89000, BestLapTimeMs: 89000, CompletedLaps: 20 }),
      createBaseFrame({ LastLapTimeMs: 88200, BestLapTimeMs: 88200, CompletedLaps: 21 }),
      createBaseFrame({ LastLapTimeMs: 87800, BestLapTimeMs: 87800, CompletedLaps: 22 }),
      createBaseFrame({ LastLapTimeMs: 87500, BestLapTimeMs: 87500, CompletedLaps: 23 }),
      createBaseFrame({ LastLapTimeMs: 87300, BestLapTimeMs: 87300, CompletedLaps: 24 }),
      createBaseFrame({ LastLapTimeMs: 87100, BestLapTimeMs: 87100, CompletedLaps: 25 }),
      createBaseFrame({ LastLapTimeMs: 87000, BestLapTimeMs: 87000, CompletedLaps: 26 })
    ]
  },
  {
    name: 'CONSISTENCY: 6 vueltas irregulares',
    description: 'Tiempos de vuelta con alta variación → INCONSISTENT performance',
    frameInterval: 3000,
    frames: [
      createBaseFrame({ LastLapTimeMs: 87000, BestLapTimeMs: 87000, CompletedLaps: 30 }),
      createBaseFrame({ LastLapTimeMs: 89500, BestLapTimeMs: 87000, CompletedLaps: 31 }),
      createBaseFrame({ LastLapTimeMs: 86800, BestLapTimeMs: 86800, CompletedLaps: 32 }),
      createBaseFrame({ LastLapTimeMs: 90200, BestLapTimeMs: 86800, CompletedLaps: 33 }),
      createBaseFrame({ LastLapTimeMs: 87400, BestLapTimeMs: 86800, CompletedLaps: 34 }),
      createBaseFrame({ LastLapTimeMs: 91000, BestLapTimeMs: 86800, CompletedLaps: 35 }),
      createBaseFrame({ LastLapTimeMs: 86900, BestLapTimeMs: 86800, CompletedLaps: 36 })
    ]
  },

  // ============================================================================
  // LAP COUNTER EVENTS: TWO_TO_GO & LAST_LAP
  // ============================================================================
  {
    name: 'TWO_TO_GO: Últimas 2 vueltas',
    description: 'RemainingLaps = 2 → TWO_TO_GO event',
    frameInterval: 2000,
    frames: [
      createBaseFrame({ RemainingLaps: 3, CompletedLaps: 37, Position: 4 }),
      createBaseFrame({ RemainingLaps: 3, CompletedLaps: 37, Position: 4 }),
      createBaseFrame({ RemainingLaps: 2, CompletedLaps: 38, Position: 4 }),
      createBaseFrame({ RemainingLaps: 2, CompletedLaps: 38, Position: 4 }),
      createBaseFrame({ RemainingLaps: 2, CompletedLaps: 38, Position: 4 })
    ]
  },
  {
    name: 'LAST_LAP: Última vuelta',
    description: 'RemainingLaps = 1 → LAST_LAP event',
    frameInterval: 2000,
    frames: [
      createBaseFrame({ RemainingLaps: 2, CompletedLaps: 38, Position: 3 }),
      createBaseFrame({ RemainingLaps: 2, CompletedLaps: 38, Position: 3 }),
      createBaseFrame({ RemainingLaps: 1, CompletedLaps: 39, Position: 3 }),
      createBaseFrame({ RemainingLaps: 1, CompletedLaps: 39, Position: 3 }),
      createBaseFrame({ RemainingLaps: 1, CompletedLaps: 39, Position: 3 })
    ]
  },

  // ============================================================================
  // OPPONENTS EVENTS: NEW_LEADER & NEW_CAR_AHEAD
  // ============================================================================
  {
    name: 'NEW_LEADER: Cambio de líder',
    description: 'Norris (P1) es adelantado por Sainz → NEW_LEADER event',
    frameInterval: 2000,
    frames: [
      createBaseFrame({ 
        Position: 5,
        OpponentsAheadOnTrack: [
          { Name: 'Hamilton', CompletedLaps: 40, Speed: 180, GapToPlayer: -2.0, TrackPositionPercent: 40.0, Position: 4 },
          { Name: 'Leclerc', CompletedLaps: 40, Speed: 185, GapToPlayer: -5.0, TrackPositionPercent: 50.0, Position: 3 },
          { Name: 'Sainz', CompletedLaps: 40, Speed: 190, GapToPlayer: -8.0, TrackPositionPercent: 60.0, Position: 2 },
          { Name: 'Norris', CompletedLaps: 40, Speed: 188, GapToPlayer: -11.0, TrackPositionPercent: 70.0, Position: 1 }
        ],
        CompletedLaps: 40
      }),
      createBaseFrame({ 
        Position: 5,
        OpponentsAheadOnTrack: [
          { Name: 'Hamilton', CompletedLaps: 40, Speed: 180, GapToPlayer: -2.0, TrackPositionPercent: 41.0, Position: 4 },
          { Name: 'Leclerc', CompletedLaps: 40, Speed: 185, GapToPlayer: -5.0, TrackPositionPercent: 51.0, Position: 3 },
          { Name: 'Sainz', CompletedLaps: 40, Speed: 192, GapToPlayer: -8.0, TrackPositionPercent: 61.0, Position: 2 },
          { Name: 'Norris', CompletedLaps: 40, Speed: 186, GapToPlayer: -10.8, TrackPositionPercent: 70.5, Position: 1 }
        ],
        CompletedLaps: 40
      }),
      // Sainz adelanta a Norris y se convierte en líder
      createBaseFrame({ 
        Position: 5,
        OpponentsAheadOnTrack: [
          { Name: 'Hamilton', CompletedLaps: 40, Speed: 180, GapToPlayer: -2.0, TrackPositionPercent: 42.0, Position: 4 },
          { Name: 'Leclerc', CompletedLaps: 40, Speed: 185, GapToPlayer: -5.0, TrackPositionPercent: 52.0, Position: 3 },
          { Name: 'Norris', CompletedLaps: 40, Speed: 186, GapToPlayer: -7.5, TrackPositionPercent: 62.0, Position: 2 },
          { Name: 'Sainz', CompletedLaps: 40, Speed: 194, GapToPlayer: -8.5, TrackPositionPercent: 72.0, Position: 1 }
        ],
        CompletedLaps: 40
      }),
      createBaseFrame({ 
        Position: 5,
        OpponentsAheadOnTrack: [
          { Name: 'Hamilton', CompletedLaps: 40, Speed: 180, GapToPlayer: -2.0, TrackPositionPercent: 43.0, Position: 4 },
          { Name: 'Leclerc', CompletedLaps: 40, Speed: 185, GapToPlayer: -5.0, TrackPositionPercent: 53.0, Position: 3 },
          { Name: 'Norris', CompletedLaps: 40, Speed: 186, GapToPlayer: -7.8, TrackPositionPercent: 63.0, Position: 2 },
          { Name: 'Sainz', CompletedLaps: 40, Speed: 194, GapToPlayer: -9.0, TrackPositionPercent: 73.0, Position: 1 }
        ],
        CompletedLaps: 41
      })
    ]
  },
  {
    name: 'NEW_CAR_AHEAD: Nuevo rival delante tras adelantamiento',
    description: 'Hamilton (P4) adelanta a Leclerc (P3), ahora Hamilton está delante del player',
    frameInterval: 2000,
    frames: [
      createBaseFrame({ 
        Position: 5,
        GapToPlayerAhead: 2.0,
        OpponentsAheadOnTrack: [
          { Name: 'Leclerc', CompletedLaps: 45, Speed: 180, GapToPlayer: -2.0, TrackPositionPercent: 40.0, Position: 4 },
          { Name: 'Hamilton', CompletedLaps: 45, Speed: 185, GapToPlayer: -5.0, TrackPositionPercent: 48.0, Position: 3 }
        ],
        CompletedLaps: 45
      }),
      createBaseFrame({ 
        Position: 5,
        GapToPlayerAhead: 2.0,
        OpponentsAheadOnTrack: [
          { Name: 'Leclerc', CompletedLaps: 45, Speed: 178, GapToPlayer: -2.0, TrackPositionPercent: 41.0, Position: 4 },
          { Name: 'Hamilton', CompletedLaps: 45, Speed: 188, GapToPlayer: -4.5, TrackPositionPercent: 49.0, Position: 3 }
        ],
        CompletedLaps: 45
      }),
      // Hamilton adelanta a Leclerc
      createBaseFrame({ 
        Position: 5,
        GapToPlayerAhead: 1.8,
        OpponentsAheadOnTrack: [
          { Name: 'Hamilton', CompletedLaps: 45, Speed: 190, GapToPlayer: -1.8, TrackPositionPercent: 42.0, Position: 4 },
          { Name: 'Leclerc', CompletedLaps: 45, Speed: 176, GapToPlayer: -4.5, TrackPositionPercent: 50.0, Position: 3 }
        ],
        CompletedLaps: 45
      }),
      createBaseFrame({ 
        Position: 5,
        GapToPlayerAhead: 1.8,
        OpponentsAheadOnTrack: [
          { Name: 'Hamilton', CompletedLaps: 45, Speed: 190, GapToPlayer: -1.8, TrackPositionPercent: 43.0, Position: 4 }
        ],
        CompletedLaps: 45
      }),
      createBaseFrame({ 
        Position: 5,
        GapToPlayerAhead: 1.9,
        OpponentsAheadOnTrack: [
          { Name: 'Hamilton', CompletedLaps: 45, Speed: 190, GapToPlayer: -1.9, TrackPositionPercent: 44.0, Position: 4 }
        ],
        CompletedLaps: 46
      })
    ]
  },

  // ============================================================================
  // LEGACY SCENARIOS (mantener compatibilidad)
  // ============================================================================
  {
    name: 'DAMAGE: Minor → Moderate → Severe',
    description: 'Daños progresivos',
    frameInterval: 2000,
    frames: [
      createBaseFrame({ CarDamagePercent: 0, CompletedLaps: 50 }),
      createBaseFrame({ CarDamagePercent: 8, CompletedLaps: 50 }),
      createBaseFrame({ CarDamagePercent: 18, CompletedLaps: 51 }),
      createBaseFrame({ CarDamagePercent: 28, CompletedLaps: 51 }),
      createBaseFrame({ CarDamagePercent: 40, CompletedLaps: 52 }),
      createBaseFrame({ CarDamagePercent: 55, CompletedLaps: 52 }),
      createBaseFrame({ CarDamagePercent: 70, CompletedLaps: 53 })
    ]
  },
  {
    name: 'SPOTTER: Car Left → Clear',
    description: 'Coche a la izquierda, luego se libera',
    frameInterval: 1500,
    frames: [
      createBaseFrame({ SpotterCarLeft: false, SpotterCarRight: false, CompletedLaps: 55 }),
      createBaseFrame({ SpotterCarLeft: false, SpotterCarRight: false, CompletedLaps: 55 }),
      createBaseFrame({ SpotterCarLeft: true, SpotterCarRight: false, CompletedLaps: 55 }),
      createBaseFrame({ SpotterCarLeft: true, SpotterCarRight: false, CompletedLaps: 55 }),
      createBaseFrame({ SpotterCarLeft: true, SpotterCarRight: false, CompletedLaps: 55 }),
      createBaseFrame({ SpotterCarLeft: true, SpotterCarRight: false, CompletedLaps: 55 }),
      createBaseFrame({ SpotterCarLeft: false, SpotterCarRight: false, CompletedLaps: 56 }),
      createBaseFrame({ SpotterCarLeft: false, SpotterCarRight: false, CompletedLaps: 56 }),
      createBaseFrame({ SpotterCarLeft: false, SpotterCarRight: false, CompletedLaps: 56 }),
      createBaseFrame({ SpotterCarLeft: false, SpotterCarRight: false, CompletedLaps: 56 })
    ]
  }
];

async function sendFrame(frame: TelemetryFrame): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = dgram.createSocket('udp4');
    const message = Buffer.from(JSON.stringify(frame));
    
    client.send(message, 9999, 'localhost', (err) => {
      client.close();
      if (err) reject(err);
      else resolve();
    });
  });
}

async function runScenario(scenario: typeof scenarios[0]): Promise<void> {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`SCENARIO: ${scenario.name}`);
  console.log(`${scenario.description}`);
  console.log(`Frames: ${scenario.frames.length} | Interval: ${scenario.frameInterval || 2000}ms`);
  console.log('='.repeat(70));
  
  const interval = scenario.frameInterval || 2000;
  
  for (let i = 0; i < scenario.frames.length; i++) {
    const frame = scenario.frames[i];
    console.log(`\n[Frame ${i + 1}/${scenario.frames.length}]`, {
      lap: frame.CompletedLaps,
      pos: frame.Position,
      gapAhead: frame.GapToPlayerAhead?.toFixed(2),
      gapBehind: frame.GapToPlayerBehind?.toFixed(2),
      damage: frame.CarDamagePercent,
      remainingLaps: frame.RemainingLaps,
      spotterLeft: frame.SpotterCarLeft,
      spotterRight: frame.SpotterCarRight,
      opponentsAhead: frame.OpponentsAheadOnTrack?.length || 0,
      opponentsBehind: frame.OpponentsBehindOnTrack?.length || 0
    });
    
    await sendFrame(frame);
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  
  console.log(`\n✅ Scenario "${scenario.name}" completed\n`);
}

async function main(): Promise<void> {
  console.log('🏁 TELEMETRY REPLAY TEST - FULL EVENT VALIDATION');
  console.log('Conectando al backend UDP (localhost:9999)...\n');
  
  console.log('INSTRUCCIONES:');
  console.log('1. Asegúrate de que el backend esté corriendo (npm run server:dev)');
  console.log('2. Abre el frontend (localhost:5173) para ver eventos en tiempo real');
  console.log('3. Abre la consola del navegador (F12) para ver logs detallados\n');
  
  console.log('EVENTOS A VALIDAR:');
  console.log('✓ HELD_UP: Gap delante < 1.0s sostenido 60s');
  console.log('✓ PRESSURED: Gap detrás < 1.0s sostenido 60s');
  console.log('✓ GAP_TREND_WARNING: Gap increasing/decreasing');
  console.log('✓ OVERTAKE: Adelantamiento confirmado (3+ frames)');
  console.log('✓ BEING_OVERTAKEN: Ser adelantado confirmado (3+ frames)');
  console.log('✓ CONSISTENCY: 6 vueltas con mejora/empeoramiento');
  console.log('✓ TWO_TO_GO: RemainingLaps = 2');
  console.log('✓ LAST_LAP: RemainingLaps = 1');
  console.log('✓ NEW_LEADER: Cambio de líder (P1)');
  console.log('✓ NEW_CAR_AHEAD: Nuevo rival delante');
  console.log('✓ DAMAGE_WARNING: Daños progresivos');
  console.log('✓ SPOTTER_ALERT: Coches cerca\n');
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  for (const scenario of scenarios) {
    await runScenario(scenario);
    console.log('Esperando 4 segundos antes del siguiente escenario...\n');
    await new Promise(resolve => setTimeout(resolve, 4000));
  }
  
  console.log('🎉 REPLAY COMPLETO - TODOS LOS ESCENARIOS EJECUTADOS');
  console.log('\n📊 RESUMEN DE VALIDACIÓN:');
  console.log(`Total de escenarios: ${scenarios.length}`);
  console.log('Verifica en la consola del navegador que todos los eventos se emitieron correctamente.');
  console.log('\nEVENTOS POR PRIORIDAD:');
  console.log('  Priority 10: SPOTTER_ALERT (inmediato)');
  console.log('  Priority 9: TWO_TO_GO, LAST_LAP (inmediato)');
  console.log('  Priority 8: DAMAGE_WARNING crítico (inmediato)');
  console.log('  Priority 7: NEW_LEADER, OVERTAKE (racecraft)');
  console.log('  Priority 6: GAP_TREND, NEW_CAR_AHEAD (racecraft)');
  console.log('  Priority 5: HELD_UP, PRESSURED (racecraft bajo)');
  console.log('  Priority 4: CONSISTENCY (info)');
}

main().catch(console.error);
