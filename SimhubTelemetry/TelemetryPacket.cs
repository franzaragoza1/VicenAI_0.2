using System;

namespace SimHubTelemetryExporter
{
    // Clase auxiliar para los datos ricos de rivales
    public class OpponentInfo
    {
        public string Name { get; set; }
        public string CarNumber { get; set; }
        public string CarName { get; set; }
        public string ClassName { get; set; }
        public double iRating { get; set; }
        public string License { get; set; }
        public string SafetyRating { get; set; }
        public double Gap { get; set; }
        public double LastLapTime { get; set; }
        public string PositionInClass { get; set; }
        public bool IsInPit { get; set; }
        public string TireCompound { get; set; }
        public bool IsRelevant { get; set; }
    }

    /// <summary>
    /// COMPLETE Telemetry Packet - Contains ALL 251+ SimHub NewData properties + iRacing ExtraProperties
    /// </summary>
    public class TelemetryPacket
    {
        // ==========================================
        // SECTION 1: METADATA & GAME STATE
        // ==========================================
        public long Timestamp { get; set; }
        public string GameName { get; set; }
        public bool GameRunning { get; set; }
        public bool GamePaused { get; set; }
        public bool GameInMenu { get; set; }
        public bool GameReplay { get; set; }
        public bool Spectating { get; set; }

        // ==========================================
        // SECTION 2: TRACK & SESSION INFO
        // ==========================================
        public string TrackName { get; set; }
        public string TrackCode { get; set; }
        public string TrackConfig { get; set; }
        public string TrackId { get; set; }
        public string TrackIdWithConfig { get; set; }
        public string TrackNameWithConfig { get; set; }
        public double TrackLength { get; set; }
        public double ReportedTrackLength { get; set; }
        public double TrackPositionMeters { get; set; }
        public double TrackPositionPercent { get; set; }
        
        public string SessionTypeName { get; set; }
        public double SessionTimeLeft { get; set; }
        public double SessionOdo { get; set; }
        public double SessionOdoLocalUnit { get; set; }
        public bool IsSessionRestart { get; set; }
        
        // ==========================================
        // SECTION 3: CAR IDENTIFICATION
        // ==========================================
        public string CarId { get; set; }
        public string CarModel { get; set; }
        public string CarClass { get; set; }
        public string PlayerName { get; set; }
        
        // ==========================================
        // SECTION 4: SPEED & RPM & GEAR
        // ==========================================
        public double SpeedKmh { get; set; }
        public double SpeedMph { get; set; }
        public double SpeedLocal { get; set; }
        public string SpeedLocalUnit { get; set; }
        public double MaxSpeedKmh { get; set; }
        public double MaxSpeedMph { get; set; }
        public double MaxSpeedLocal { get; set; }
        public double GroundSpeedKmH { get; set; }
        public double GroundSpeedLocal { get; set; }
        
        public double Rpms { get; set; }
        public double MaxRpm { get; set; }
        public double Redline { get; set; }
        public string Gear { get; set; }
        
        public bool EngineIgnitionOn { get; set; }
        public bool EngineStarted { get; set; }
        public double EngineTorque { get; set; }
        public double MaxEngineTorque { get; set; }
        public int EngineMap { get; set; }
        
        // ==========================================
        // SECTION 5: INPUTS
        // ==========================================
        public double Throttle { get; set; }
        public double Brake { get; set; }
        public double Clutch { get; set; }
        public double Handbrake { get; set; }
        
        // ==========================================
        // SECTION 6: ACCELERATION & ORIENTATION
        // ==========================================
        public double AccelerationSurge { get; set; }
        public double AccelerationSway { get; set; }
        public double AccelerationHeave { get; set; }
        public double GlobalAccelerationG { get; set; }
        
        public double OrientationPitch { get; set; }
        public double OrientationRoll { get; set; }
        public double OrientationYaw { get; set; }
        public double OrientationYawWorld { get; set; }
        public double OrientationPitchAcceleration { get; set; }
        public double OrientationRollAcceleration { get; set; }
        public double OrientationYawAcceleration { get; set; }
        public double OrientationYawVelocity { get; set; }
        public double PitchChangeVelocity { get; set; }
        public double RollChangeVelocity { get; set; }
        public double YawChangeVelocity { get; set; }
        
        // ==========================================
        // SECTION 7: TYRES (Temperature, Pressure, Wear, Dirt)
        // ==========================================
        public double TyreTemperatureFrontLeft { get; set; }
        public double TyreTemperatureFrontRight { get; set; }
        public double TyreTemperatureRearLeft { get; set; }
        public double TyreTemperatureRearRight { get; set; }
        
        public double TyreTemperatureFrontLeftInner { get; set; }
        public double TyreTemperatureFrontLeftMiddle { get; set; }
        public double TyreTemperatureFrontLeftOuter { get; set; }
        public double TyreTemperatureFrontRightInner { get; set; }
        public double TyreTemperatureFrontRightMiddle { get; set; }
        public double TyreTemperatureFrontRightOuter { get; set; }
        public double TyreTemperatureRearLeftInner { get; set; }
        public double TyreTemperatureRearLeftMiddle { get; set; }
        public double TyreTemperatureRearLeftOuter { get; set; }
        public double TyreTemperatureRearRightInner { get; set; }
        public double TyreTemperatureRearRightMiddle { get; set; }
        public double TyreTemperatureRearRightOuter { get; set; }
        
        public double TyresTemperatureAvg { get; set; }
        public double TyresTemperatureMax { get; set; }
        public double TyresTemperatureMin { get; set; }
        
        public double TyrePressureFrontLeft { get; set; }
        public double TyrePressureFrontRight { get; set; }
        public double TyrePressureRearLeft { get; set; }
        public double TyrePressureRearRight { get; set; }
        public string TyrePressureUnit { get; set; }
        
        public double TyreWearFrontLeft { get; set; }
        public double TyreWearFrontRight { get; set; }
        public double TyreWearRearLeft { get; set; }
        public double TyreWearRearRight { get; set; }
        
        public double LastLapTyreWearFrontLeft { get; set; }
        public double LastLapTyreWearFrontRight { get; set; }
        public double LastLapTyreWearRearLeft { get; set; }
        public double LastLapTyreWearRearRight { get; set; }
        
        public double TyresWearAvg { get; set; }
        public double TyresWearMax { get; set; }
        public double TyresWearMin { get; set; }
        
        public double TyreDirtFrontLeft { get; set; }
        public double TyreDirtFrontRight { get; set; }
        public double TyreDirtRearLeft { get; set; }
        public double TyreDirtRearRight { get; set; }
        public double TyresDirtyLevelAvg { get; set; }
        public double TyresDirtyLevelMax { get; set; }
        public double TyresDirtyLevelMin { get; set; }
        
        // ==========================================
        // SECTION 8: BRAKES
        // ==========================================
        public double BrakeTemperatureFrontLeft { get; set; }
        public double BrakeTemperatureFrontRight { get; set; }
        public double BrakeTemperatureRearLeft { get; set; }
        public double BrakeTemperatureRearRight { get; set; }
        public double BrakesTemperatureAvg { get; set; }
        public double BrakesTemperatureMax { get; set; }
        public double BrakesTemperatureMin { get; set; }
        public double BrakeBias { get; set; }
        
        // ==========================================
        // SECTION 9: FUEL & CONSUMPTION
        // ==========================================
        public double Fuel { get; set; }
        public double FuelRaw { get; set; }
        public double FuelPercent { get; set; }
        public double MaxFuel { get; set; }
        public string FuelUnit { get; set; }
        public double EstimatedFuelRemaingLaps { get; set; }
        public double InstantConsumption_L100KM { get; set; }
        public double InstantConsumption_MPG_UK { get; set; }
        public double InstantConsumption_MPG_US { get; set; }
        
        // ==========================================
        // SECTION 10: TEMPERATURES & ENVIRONMENT
        // ==========================================
        public double AirTemperature { get; set; }
        public double RoadTemperature { get; set; }
        public string TemperatureUnit { get; set; }
        public double WaterTemperature { get; set; }
        public double OilTemperature { get; set; }
        public double OilPressure { get; set; }
        public string OilPressureUnit { get; set; }
        
        // ==========================================
        // SECTION 11: TURBO & ERS & DRS
        // ==========================================
        public double Turbo { get; set; }
        public double TurboBar { get; set; }
        public double TurboPercent { get; set; }
        public double MaxTurbo { get; set; }
        public double MaxTurboBar { get; set; }
        
        public double ERSStored { get; set; }
        public double ERSMax { get; set; }
        public double ERSPercent { get; set; }
        
        public bool DRSAvailable { get; set; }
        public bool DRSEnabled { get; set; }
        
        // ==========================================
        // SECTION 12: RACE POSITION & LAPS
        // ==========================================
        public int Position { get; set; }
        public int PlayerLeaderboardPosition { get; set; }
        public int CurrentLap { get; set; }
        public int CompletedLaps { get; set; }
        public int TotalLaps { get; set; }
        public int RemainingLaps { get; set; }
        
        // ==========================================
        // SECTION 13: LAP TIMES & SECTORS
        // ==========================================
        public double CurrentLapTime { get; set; }
        public double LastLapTime { get; set; }
        public double BestLapTime { get; set; }
        public double AllTimeBest { get; set; }
        public double LastSectorTime { get; set; }
        public double LastSectorTimeAnyLap { get; set; }
        
        public int CurrentSectorIndex { get; set; }
        public int SectorsCount { get; set; }
        
        public double Sector1Time { get; set; }
        public double Sector2Time { get; set; }
        public double Sector1LastLapTime { get; set; }
        public double Sector2LastLapTime { get; set; }
        public double Sector3LastLapTime { get; set; }
        public double Sector1BestTime { get; set; }
        public double Sector2BestTime { get; set; }
        public double Sector3BestTime { get; set; }
        public double Sector1BestLapTime { get; set; }
        public double Sector2BestLapTime { get; set; }
        public double Sector3BestLapTime { get; set; }
        
        public bool IsLapValid { get; set; }
        public bool LapInvalidated { get; set; }
        
        public double DeltaToSessionBest { get; set; }
        public double DeltaToAllTimeBest { get; set; }
        public double BestSplitDelta { get; set; }
        public double SelfsplitDelta { get; set; }
        
        // ==========================================
        // SECTION 14: CAR DAMAGE
        // ==========================================
        public double CarDamage1 { get; set; }
        public double CarDamage2 { get; set; }
        public double CarDamage3 { get; set; }
        public double CarDamage4 { get; set; }
        public double CarDamage5 { get; set; }
        public double CarDamagesAvg { get; set; }
        public double CarDamagesMax { get; set; }
        public double CarDamagesMin { get; set; }
        
        // ==========================================
        // SECTION 15: TC & ABS
        // ==========================================
        public bool TCActive { get; set; }
        public int TCLevel { get; set; }
        public bool ABSActive { get; set; }
        public int ABSLevel { get; set; }
        
        // ==========================================
        // SECTION 16: FLAGS
        // ==========================================
        public string Flag_Name { get; set; }
        public bool Flag_Yellow { get; set; }
        public bool Flag_Blue { get; set; }
        public bool Flag_White { get; set; }
        public bool Flag_Black { get; set; }
        public bool Flag_Green { get; set; }
        public bool Flag_Checkered { get; set; }
        public bool Flag_Orange { get; set; }
        
        // ==========================================
        // SECTION 17: PIT & PIT LIMITER
        // ==========================================
        public bool IsInPit { get; set; }
        public bool IsInPitLane { get; set; }
        public double IsInPitSince { get; set; }
        public bool PitLimiterOn { get; set; }
        public double PitLimiterSpeed { get; set; }
        public double PitLimiterSpeedMs { get; set; }
        public double LastPitStopDuration { get; set; }
        
        // ==========================================
        // SECTION 18: SPOTTER
        // ==========================================
        public bool SpotterCarLeft { get; set; }
        public double SpotterCarLeftAngle { get; set; }
        public double SpotterCarLeftDistance { get; set; }
        public bool SpotterCarRight { get; set; }
        public double SpotterCarRightAngle { get; set; }
        public double SpotterCarRightDistance { get; set; }
        
        // ==========================================
        // SECTION 19: OPPONENTS & MULTICLASS
        // ==========================================
        public int OpponentsCount { get; set; }
        public int PlayerClassOpponentsCount { get; set; }
        public bool HasMultipleClassOpponents { get; set; }
        
        // ==========================================
        // SECTION 20: MISC
        // ==========================================
        public string ReplayMode { get; set; }
        public bool MapAllowed { get; set; }
        public double DraftEstimate { get; set; }
        public bool PushToPassActive { get; set; }
        public double StintOdo { get; set; }
        public double StintOdoLocalUnit { get; set; }
        public bool TurnIndicatorLeft { get; set; }
        public bool TurnIndicatorRight { get; set; }
        
        // ==========================================
        // SECTION 21: CAR SETTINGS
        // ==========================================
        public int CarSettings_MaxGears { get; set; }
        public double CarSettings_MaxRPM { get; set; }
        public double CarSettings_RedLineRPM { get; set; }
        public double CarSettings_RedLineDisplayedPercent { get; set; }
        public double CarSettings_CurrentDisplayedRPMPercent { get; set; }
        public double CarSettings_CurrentGearRedLineRPM { get; set; }
        public double CarSettings_RPMRedLineReached { get; set; }
        public double CarSettings_RPMShiftLight1 { get; set; }
        public double CarSettings_RPMShiftLight2 { get; set; }
        public bool CarSettings_FuelAlertActive { get; set; }
        public bool CarSettings_FuelAlertEnabled { get; set; }
        public double CarSettings_FuelAlertLaps { get; set; }
        public double CarSettings_FuelAlertFuelRemainingLaps { get; set; }
        
        // ==========================================
        // SECTION 22: IRACING EXTRA PROPERTIES
        // ==========================================
        public double iRacing_Player_iRating { get; set; }
        public string iRacing_Player_License { get; set; }
        public string iRacing_Player_SafetyRating { get; set; }
        public string iRacing_Player_CarNumber { get; set; }
        public int iRacing_Player_Position { get; set; }
        public int iRacing_Player_PositionInClass { get; set; }
        public int iRacing_Player_LapsSinceLastPit { get; set; }
        public double iRacing_Player_LastPitStopDuration { get; set; }
        
        public double iRacing_FuelToAdd { get; set; }
        public double iRacing_FuelToAddKg { get; set; }
        public double iRacing_FuelMaxFuelPerLap { get; set; }
        
        public double iRacing_SOF { get; set; }
        public int iRacing_TotalLaps { get; set; }
        public int iRacing_LapsRemaining { get; set; }
        
        public double iRacing_TrackTemperatureChange { get; set; }
        public double iRacing_AirTemperatureChange { get; set; }
        
        public bool iRacing_PitWindowIsOpen { get; set; }
        public double iRacing_PitSpeedLimitKph { get; set; }
        public double iRacing_DistanceToPitEntry { get; set; }
        
        public double iRacing_CurrentSectorTime { get; set; }
        public int iRacing_CurrentSectorIndex { get; set; }
        public double iRacing_CurrentSectorBestTime { get; set; }
        
        public double iRacing_OptimalLapTime { get; set; }
        
        public double iRacing_Hybrid_SoC { get; set; }
        public double iRacing_Hybrid_Deploy { get; set; }
        public string iRacing_Hybrid_DeployMode { get; set; }
        
        public int iRacing_PushToPassCount { get; set; }
        public bool iRacing_PushToPassActive { get; set; }
        
        public double iRacing_SessionBestLapTime { get; set; }
        
        // ==========================================
        // SECTION 23: OPPONENT STRUCTURES
        // ==========================================
        public OpponentInfo DriverAhead_Global { get; set; }
        public OpponentInfo DriverBehind_Global { get; set; }
        public OpponentInfo DriverAhead_Class { get; set; }
        public OpponentInfo DriverBehind_Class { get; set; }
        public OpponentInfo ClassLeader { get; set; }
        
        public OpponentInfo OpponentAhead { get; set; }
        public OpponentInfo OpponentBehind { get; set; }
        public OpponentInfo Leader { get; set; }
        public double GapToLeader { get; set; }
    }
}