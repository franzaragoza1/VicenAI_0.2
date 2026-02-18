using GameReaderCommon;
using SimHub.Plugins;
using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;
using System;
using System.Net.Sockets;
using System.Text;

namespace SimHubTelemetryExporter
{
    [PluginName("AI Racing Engineer - Pro Telemetry")]
    [PluginDescription("Exports FULL telemetry for Lab analysis + Rich Context for AI")]
    public class SmartTelemetryPlugin : IPlugin, IDataPlugin
    {
        public PluginManager PluginManager { get; set; }
        private UdpClient udp;
        private const string TARGET_IP = "127.0.0.1";
        private const int TARGET_PORT = 9999;
        private JsonSerializerSettings jsonSettings;
        private int frameCounter = 0; // Para debug logging

        public void Init(PluginManager pluginManager)
        {
            PluginManager = pluginManager;
            udp = new UdpClient();
            jsonSettings = new JsonSerializerSettings
            {
                ContractResolver = new CamelCasePropertyNamesContractResolver(),
                NullValueHandling = NullValueHandling.Ignore
            };
        }

        public void DataUpdate(PluginManager pluginManager, ref GameData data)
        {
            if (!data.GameRunning || data.NewData == null) return;
            
            try
            {
                var packet = BuildFullPacket(data);
                SendPacket(packet);
                frameCounter++;
            }
            catch
            {
                // Ignorar errores UDP
            }
        }

        public void End(PluginManager pluginManager)
        {
            udp?.Close();
            udp = null;
        }

        private TelemetryPacket BuildFullPacket(GameData data)
        {
            var p = new TelemetryPacket();
            var n = data.NewData;

            // ==========================================
            // SECCIÓN 1: METADATA & GAME STATE
            // ==========================================
            p.Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            p.GameName = data.GameName;
            p.GameRunning = data.GameRunning;
            p.GamePaused = data.GamePaused;
            p.GameInMenu = data.GameInMenu;
            p.GameReplay = data.GameReplay;
            // p.IsGameInRace = data.IsGameInRace; // Property doesn't exist in GameData
            p.Spectating = n.Spectating;

            // ==========================================
            // SECCIÓN 2: TRACK & SESSION INFO (251 NewData properties)
            // ==========================================
            p.TrackName = n.TrackName;
            p.TrackCode = n.TrackCode;
            p.TrackConfig = n.TrackConfig;
            p.TrackId = n.TrackId;
            p.TrackIdWithConfig = n.TrackIdWithConfig;
            p.TrackNameWithConfig = n.TrackNameWithConfig;
            p.TrackLength = n.TrackLength;
            p.ReportedTrackLength = n.ReportedTrackLength;
            p.TrackPositionMeters = n.TrackPositionMeters;
            p.TrackPositionPercent = n.TrackPositionPercent;
            
            p.SessionTypeName = n.SessionTypeName;
            p.SessionTimeLeft = GetSecs(n.SessionTimeLeft);
            p.SessionOdo = n.SessionOdo;
            p.SessionOdoLocalUnit = n.SessionOdoLocalUnit;
            p.IsSessionRestart = n.IsSessionRestart;
            
            // ==========================================
            // SECCIÓN 3: CAR IDENTIFICATION
            // ==========================================
            p.CarId = n.CarId;
            p.CarModel = n.CarModel;
            p.CarClass = n.CarClass;
            p.PlayerName = n.PlayerName;
            
            // ==========================================
            // SECCIÓN 4: SPEED & RPM & GEAR
            // ==========================================
            p.SpeedKmh = n.SpeedKmh;
            p.SpeedMph = n.SpeedMph;
            p.SpeedLocal = n.SpeedLocal;
            p.SpeedLocalUnit = n.SpeedLocalUnit;
            // p.FilteredSpeedKmh = n.FilteredSpeedKmh; // Obsolete property
            // p.FilteredSpeedMph = n.FilteredSpeedMph; // Obsolete property
            // p.FilteredSpeedLocal = n.FilteredSpeedLocal; // Obsolete property
            p.MaxSpeedKmh = n.MaxSpeedKmh;
            p.MaxSpeedMph = n.MaxSpeedMph;
            p.MaxSpeedLocal = n.MaxSpeedLocal;
            p.GroundSpeedKmH = n.GroundSpeedKmH ?? 0;
            p.GroundSpeedLocal = n.GroundSpeedLocal ?? 0;
            
            p.Rpms = n.Rpms;
            // p.FilteredRpms = n.FilteredRpms; // Obsolete property
            p.MaxRpm = n.MaxRpm;
            p.Redline = n.Redline;
            p.Gear = n.Gear;
            
            p.EngineIgnitionOn = n.EngineIgnitionOn > 0;
            p.EngineStarted = n.EngineStarted > 0;
            p.EngineTorque = n.EngineTorque;
            p.MaxEngineTorque = n.MaxEngineTorque;
            p.EngineMap = n.EngineMap;
            
            // ==========================================
            // SECCIÓN 5: INPUTS
            // ==========================================
            p.Throttle = n.Throttle;
            p.Brake = n.Brake;
            p.Clutch = n.Clutch;
            p.Handbrake = n.Handbrake;
            
            // ==========================================
            // SECCIÓN 6: ACCELERATION & ORIENTATION
            // ==========================================
            p.AccelerationSurge = n.AccelerationSurge ?? 0;
            p.AccelerationSway = n.AccelerationSway ?? 0;
            p.AccelerationHeave = n.AccelerationHeave ?? 0;
            p.GlobalAccelerationG = n.GlobalAccelerationG;
            
            p.OrientationPitch = n.OrientationPitch;
            p.OrientationRoll = n.OrientationRoll;
            p.OrientationYaw = n.OrientationYaw;
            p.OrientationYawWorld = n.OrientationYawWorld;
            p.OrientationPitchAcceleration = n.OrientationPitchAcceleration;
            p.OrientationRollAcceleration = n.OrientationRollAcceleration;
            p.OrientationYawAcceleration = n.OrientationYawAcceleration;
            p.OrientationYawVelocity = n.OrientationYawVelocity;
            p.PitchChangeVelocity = n.PitchChangeVelocity ?? 0;
            p.RollChangeVelocity = n.RollChangeVelocity ?? 0;
            p.YawChangeVelocity = n.YawChangeVelocity ?? 0;
            
            // ==========================================
            // SECCIÓN 7: TYRES (Temperature, Pressure, Wear, Dirt)
            // ==========================================
            p.TyreTemperatureFrontLeft = n.TyreTemperatureFrontLeft;
            p.TyreTemperatureFrontRight = n.TyreTemperatureFrontRight;
            p.TyreTemperatureRearLeft = n.TyreTemperatureRearLeft;
            p.TyreTemperatureRearRight = n.TyreTemperatureRearRight;
            
            p.TyreTemperatureFrontLeftInner = n.TyreTemperatureFrontLeftInner;
            p.TyreTemperatureFrontLeftMiddle = n.TyreTemperatureFrontLeftMiddle;
            p.TyreTemperatureFrontLeftOuter = n.TyreTemperatureFrontLeftOuter;
            p.TyreTemperatureFrontRightInner = n.TyreTemperatureFrontRightInner;
            p.TyreTemperatureFrontRightMiddle = n.TyreTemperatureFrontRightMiddle;
            p.TyreTemperatureFrontRightOuter = n.TyreTemperatureFrontRightOuter;
            p.TyreTemperatureRearLeftInner = n.TyreTemperatureRearLeftInner;
            p.TyreTemperatureRearLeftMiddle = n.TyreTemperatureRearLeftMiddle;
            p.TyreTemperatureRearLeftOuter = n.TyreTemperatureRearLeftOuter;
            p.TyreTemperatureRearRightInner = n.TyreTemperatureRearRightInner;
            p.TyreTemperatureRearRightMiddle = n.TyreTemperatureRearRightMiddle;
            p.TyreTemperatureRearRightOuter = n.TyreTemperatureRearRightOuter;
            
            p.TyresTemperatureAvg = n.TyresTemperatureAvg;
            p.TyresTemperatureMax = n.TyresTemperatureMax;
            p.TyresTemperatureMin = n.TyresTemperatureMin;
            
            p.TyrePressureFrontLeft = n.TyrePressureFrontLeft;
            p.TyrePressureFrontRight = n.TyrePressureFrontRight;
            p.TyrePressureRearLeft = n.TyrePressureRearLeft;
            p.TyrePressureRearRight = n.TyrePressureRearRight;
            p.TyrePressureUnit = n.TyrePressureUnit;
            
            p.TyreWearFrontLeft = n.TyreWearFrontLeft;
            p.TyreWearFrontRight = n.TyreWearFrontRight;
            p.TyreWearRearLeft = n.TyreWearRearLeft;
            p.TyreWearRearRight = n.TyreWearRearRight;
            
            p.LastLapTyreWearFrontLeft = n.LastLapTyreWearFrontLeft;
            p.LastLapTyreWearFrontRight = n.LastLapTyreWearFrontRight;
            p.LastLapTyreWearRearLeft = n.LastLapTyreWearRearLeft;
            p.LastLapTyreWearRearRight = n.LastLapTyreWearRearRight;
            
            p.TyresWearAvg = n.TyresWearAvg;
            p.TyresWearMax = n.TyresWearMax;
            p.TyresWearMin = n.TyresWearMin;
            
            p.TyreDirtFrontLeft = n.TyreDirtFrontLeft;
            p.TyreDirtFrontRight = n.TyreDirtFrontRight;
            p.TyreDirtRearLeft = n.TyreDirtRearLeft;
            p.TyreDirtRearRight = n.TyreDirtRearRight;
            p.TyresDirtyLevelAvg = n.TyresDirtyLevelAvg;
            p.TyresDirtyLevelMax = n.TyresDirtyLevelMax;
            p.TyresDirtyLevelMin = n.TyresDirtyLevelMin;
            
            // ==========================================
            // SECCIÓN 8: BRAKES
            // ==========================================
            p.BrakeTemperatureFrontLeft = n.BrakeTemperatureFrontLeft;
            p.BrakeTemperatureFrontRight = n.BrakeTemperatureFrontRight;
            p.BrakeTemperatureRearLeft = n.BrakeTemperatureRearLeft;
            p.BrakeTemperatureRearRight = n.BrakeTemperatureRearRight;
            p.BrakesTemperatureAvg = n.BrakesTemperatureAvg;
            p.BrakesTemperatureMax = n.BrakesTemperatureMax;
            p.BrakesTemperatureMin = n.BrakesTemperatureMin;
            p.BrakeBias = n.BrakeBias;
            
            // ==========================================
            // SECCIÓN 9: FUEL & CONSUMPTION
            // ==========================================
            p.Fuel = n.Fuel;
            p.FuelRaw = n.FuelRaw;
            p.FuelPercent = n.FuelPercent;
            p.MaxFuel = n.MaxFuel;
            p.FuelUnit = n.FuelUnit;
            p.EstimatedFuelRemaingLaps = n.EstimatedFuelRemaingLaps ?? 0;
            p.InstantConsumption_L100KM = n.InstantConsumption_L100KM;
            p.InstantConsumption_MPG_UK = n.InstantConsumption_MPG_UK;
            p.InstantConsumption_MPG_US = n.InstantConsumption_MPG_US;
            
            // ==========================================
            // SECCIÓN 10: TEMPERATURES & ENVIRONMENT
            // ==========================================
            p.AirTemperature = n.AirTemperature;
            p.RoadTemperature = n.RoadTemperature;
            p.TemperatureUnit = n.TemperatureUnit;
            p.WaterTemperature = n.WaterTemperature;
            p.OilTemperature = n.OilTemperature;
            p.OilPressure = n.OilPressure;
            p.OilPressureUnit = n.OilPressureUnit;
            
            // ==========================================
            // SECCIÓN 11: TURBO & ERS & DRS
            // ==========================================
            p.Turbo = n.Turbo;
            p.TurboBar = n.TurboBar;
            p.TurboPercent = n.TurboPercent;
            p.MaxTurbo = n.MaxTurbo;
            p.MaxTurboBar = n.MaxTurboBar;
            
            p.ERSStored = n.ERSStored;
            p.ERSMax = n.ERSMax;
            p.ERSPercent = n.ERSPercent;
            
            p.DRSAvailable = n.DRSAvailable > 0;
            p.DRSEnabled = n.DRSEnabled > 0;
            
            // ==========================================
            // SECCIÓN 12: RACE POSITION & LAPS
            // ==========================================
            p.Position = n.Position;
            p.PlayerLeaderboardPosition = n.PlayerLeaderboardPosition;
            p.CurrentLap = n.CurrentLap;
            p.CompletedLaps = n.CompletedLaps;
            p.TotalLaps = n.TotalLaps;
            p.RemainingLaps = n.RemainingLaps;
            
            // ==========================================
            // SECCIÓN 13: LAP TIMES & SECTORS
            // ==========================================
            p.CurrentLapTime = GetSecs(n.CurrentLapTime);
            p.LastLapTime = GetSecs(n.LastLapTime);
            p.BestLapTime = GetSecs(n.BestLapTime);
            p.AllTimeBest = GetSecs(n.AllTimeBest);
            p.LastSectorTime = GetSecs(n.LastSectorTime);
            p.LastSectorTimeAnyLap = GetSecs(n.LastSectorTimeAnyLap);
            
            p.CurrentSectorIndex = n.CurrentSectorIndex;
            p.SectorsCount = n.SectorsCount ?? 0;
            
            p.Sector1Time = GetSecs(n.Sector1Time);
            p.Sector2Time = GetSecs(n.Sector2Time);
            p.Sector1LastLapTime = GetSecs(n.Sector1LastLapTime);
            p.Sector2LastLapTime = GetSecs(n.Sector2LastLapTime);
            p.Sector3LastLapTime = GetSecs(n.Sector3LastLapTime);
            p.Sector1BestTime = GetSecs(n.Sector1BestTime);
            p.Sector2BestTime = GetSecs(n.Sector2BestTime);
            p.Sector3BestTime = GetSecs(n.Sector3BestTime);
            p.Sector1BestLapTime = GetSecs(n.Sector1BestLapTime);
            p.Sector2BestLapTime = GetSecs(n.Sector2BestLapTime);
            p.Sector3BestLapTime = GetSecs(n.Sector3BestLapTime);
            
            p.IsLapValid = n.IsLapValid;
            p.LapInvalidated = n.LapInvalidated;
            
            p.DeltaToSessionBest = n.DeltaToSessionBest ?? 0;
            p.DeltaToAllTimeBest = n.DeltaToAllTimeBest ?? 0;
            p.BestSplitDelta = n.BestSplitDelta ?? 0;
            p.SelfsplitDelta = n.SelfsplitDelta ?? 0;
            
            // ==========================================
            // SECCIÓN 14: CAR DAMAGE
            // ==========================================
            p.CarDamage1 = n.CarDamage1;
            p.CarDamage2 = n.CarDamage2;
            p.CarDamage3 = n.CarDamage3;
            p.CarDamage4 = n.CarDamage4;
            p.CarDamage5 = n.CarDamage5;
            p.CarDamagesAvg = n.CarDamagesAvg;
            p.CarDamagesMax = n.CarDamagesMax;
            p.CarDamagesMin = n.CarDamagesMin;
            
            // ==========================================
            // SECCIÓN 15: TC & ABS
            // ==========================================
            p.TCActive = n.TCActive > 0;
            p.TCLevel = n.TCLevel;
            p.ABSActive = n.ABSActive > 0;
            p.ABSLevel = n.ABSLevel;
            
            // ==========================================
            // SECCIÓN 16: FLAGS
            // ==========================================
            p.Flag_Name = n.Flag_Name;
            p.Flag_Yellow = n.Flag_Yellow > 0;
            p.Flag_Blue = n.Flag_Blue > 0;
            p.Flag_White = n.Flag_White > 0;
            p.Flag_Black = n.Flag_Black > 0;
            p.Flag_Green = n.Flag_Green > 0;
            p.Flag_Checkered = n.Flag_Checkered > 0;
            p.Flag_Orange = n.Flag_Orange > 0;
            
            // ==========================================
            // SECCIÓN 17: PIT & PIT LIMITER
            // ==========================================
            p.IsInPit = n.IsInPit > 0;
            p.IsInPitLane = n.IsInPitLane > 0;
            p.IsInPitSince = n.IsInPitSince;
            p.PitLimiterOn = n.PitLimiterOn > 0;
            p.PitLimiterSpeed = n.PitLimiterSpeed ?? 0;
            p.PitLimiterSpeedMs = n.PitLimiterSpeedMs ?? 0;
            p.LastPitStopDuration = n.LastPitStopDuration;
            
            // ==========================================
            // SECCIÓN 18: SPOTTER
            // ==========================================
            p.SpotterCarLeft = n.SpotterCarLeft > 0;
            p.SpotterCarLeftAngle = n.SpotterCarLeftAngle;
            p.SpotterCarLeftDistance = n.SpotterCarLeftDistance;
            p.SpotterCarRight = n.SpotterCarRight > 0;
            p.SpotterCarRightAngle = n.SpotterCarRightAngle;
            p.SpotterCarRightDistance = n.SpotterCarRightDistance;
            
            // ==========================================
            // SECCIÓN 19: OPPONENTS & MULTICLASS
            // ==========================================
            p.OpponentsCount = n.OpponentsCount;
            p.PlayerClassOpponentsCount = n.PlayerClassOpponentsCount;
            p.HasMultipleClassOpponents = n.HasMultipleClassOpponents;
            
            // ==========================================
            // SECCIÓN 20: MISC
            // ==========================================
            p.ReplayMode = n.ReplayMode;
            p.MapAllowed = n.MapAllowed;
            p.DraftEstimate = n.DraftEstimate;
            p.PushToPassActive = n.PushToPassActive ?? false;
            p.StintOdo = n.StintOdo;
            p.StintOdoLocalUnit = n.StintOdoLocalUnit;
            p.TurnIndicatorLeft = n.TurnIndicatorLeft > 0;
            p.TurnIndicatorRight = n.TurnIndicatorRight > 0;
            
            // ==========================================
            // SECCIÓN 21: CAR SETTINGS
            // ==========================================
            p.CarSettings_MaxGears = n.CarSettings_MaxGears;
            p.CarSettings_MaxRPM = n.CarSettings_MaxRPM;
            p.CarSettings_RedLineRPM = n.CarSettings_RedLineRPM;
            p.CarSettings_RedLineDisplayedPercent = n.CarSettings_RedLineDisplayedPercent;
            p.CarSettings_CurrentDisplayedRPMPercent = n.CarSettings_CurrentDisplayedRPMPercent;
            p.CarSettings_CurrentGearRedLineRPM = n.CarSettings_CurrentGearRedLineRPM;
            p.CarSettings_RPMRedLineReached = n.CarSettings_RPMRedLineReached;
            p.CarSettings_RPMShiftLight1 = n.CarSettings_RPMShiftLight1;
            p.CarSettings_RPMShiftLight2 = n.CarSettings_RPMShiftLight2;
            p.CarSettings_FuelAlertActive = n.CarSettings_FuelAlertActive > 0;
            p.CarSettings_FuelAlertEnabled = n.CarSettings_FuelAlertEnabled > 0;
            p.CarSettings_FuelAlertLaps = n.CarSettings_FuelAlertLaps;
            p.CarSettings_FuelAlertFuelRemainingLaps = n.CarSettings_FuelAlertFuelRemainingLaps;
            
            // ==========================================
            // SECCIÓN 22: IRACING EXTRA PROPERTIES (selective)
            // ==========================================
            if (data.GameName == "IRacing")
            {
                // Player Info
                p.iRacing_Player_iRating = GetProp<double>("IRacingExtraProperties.iRacing_Player_iRating");
                p.iRacing_Player_License = GetProp<string>("IRacingExtraProperties.iRacing_Player_LicenceString");
                p.iRacing_Player_SafetyRating = GetProp<string>("IRacingExtraProperties.iRacing_Player_SafetyRating");
                p.iRacing_Player_CarNumber = GetProp<string>("IRacingExtraProperties.iRacing_Player_CarNumber");
                p.iRacing_Player_Position = GetProp<int>("IRacingExtraProperties.iRacing_Player_Position");
                p.iRacing_Player_PositionInClass = GetProp<int>("IRacingExtraProperties.iRacing_Player_PositionInClass");
                p.iRacing_Player_LapsSinceLastPit = GetProp<int>("IRacingExtraProperties.iRacing_Player_LapsSinceLastPit");
                p.iRacing_Player_LastPitStopDuration = GetProp<double>("IRacingExtraProperties.iRacing_Player_LastPitStopDuration");
                
                // Fuel Strategy
                p.iRacing_FuelToAdd = GetProp<double>("IRacingExtraProperties.iRacing_FuelToAdd");
                p.iRacing_FuelToAddKg = GetProp<double>("IRacingExtraProperties.iRacing_FuelToAddKg");
                p.iRacing_FuelMaxFuelPerLap = GetProp<double>("IRacingExtraProperties.iRacing_FuelMaxFuelPerLap");
                
                // Session Info
                p.iRacing_SOF = GetProp<double>("IRacingExtraProperties.iRacing_Class_SoF");
                p.iRacing_TotalLaps = GetProp<int>("IRacingExtraProperties.iRacing_TotalLaps");
                p.iRacing_LapsRemaining = GetProp<int>("IRacingExtraProperties.iRacing_LapsRemaining");
                
                // Track Conditions
                p.iRacing_TrackTemperatureChange = GetProp<double>("IRacingExtraProperties.iRacing_TrackTemperatureChange");
                p.iRacing_AirTemperatureChange = GetProp<double>("IRacingExtraProperties.iRacing_AirTemperatureChange");
                
                // Pit Info
                p.iRacing_PitWindowIsOpen = GetProp<bool>("IRacingExtraProperties.iRacing_PitWindowIsOpen");
                p.iRacing_PitSpeedLimitKph = GetProp<double>("IRacingExtraProperties.iRacing_PitSpeedLimitKph");
                p.iRacing_DistanceToPitEntry = GetProp<double>("IRacingExtraProperties.iRacing_DistanceToPitEntry");
                
                // Sectors (iRacing specific)
                p.iRacing_CurrentSectorTime = GetProp<double>("IRacingExtraProperties.CurrentSector_Time");
                p.iRacing_CurrentSectorIndex = GetProp<int>("IRacingExtraProperties.CurrentSector_Index");
                p.iRacing_CurrentSectorBestTime = GetProp<double>("IRacingExtraProperties.CurrentSector_BestTime");
                
                // Optimal Lap
                p.iRacing_OptimalLapTime = GetProp<double>("IRacingExtraProperties.OptimalLapTime");
                
                // Hybrid/ERS (for LMDh/LMH)
                p.iRacing_Hybrid_SoC = GetProp<double>("IRacingExtraProperties.Hybrid_SoC");
                p.iRacing_Hybrid_Deploy = GetProp<double>("IRacingExtraProperties.Hybrid_Deploy");
                p.iRacing_Hybrid_DeployMode = GetProp<string>("IRacingExtraProperties.Hybrid_DeployMode");
                
                // Push to Pass
                p.iRacing_PushToPassCount = GetProp<int>("IRacingExtraProperties.iRacing_PushToPassCount");
                p.iRacing_PushToPassActive = GetProp<bool>("IRacingExtraProperties.iRacing_PushToPassActive");
                
                // Session Best
                p.iRacing_SessionBestLapTime = GetProp<double>("IRacingExtraProperties.iRacing_Session_OverallBestLapTime");
                
                // Opponents (structured)
                p.DriverAhead_Global = FetchOpponent("IRacingExtraProperties.iRacing_DriverAhead_00_");
                p.DriverBehind_Global = FetchOpponent("IRacingExtraProperties.iRacing_DriverBehind_00_");
                p.DriverAhead_Class = FetchOpponent("IRacingExtraProperties.iRacing_DriverAheadInClass_00_");
                p.DriverBehind_Class = FetchOpponent("IRacingExtraProperties.iRacing_DriverBehindInClass_00_");
                p.ClassLeader = FetchOpponent("IRacingExtraProperties.iRacing_ClassLeaderboard_Driver_00_");
            }

            // ==========================================
            // SECCIÓN 23: GENERIC OPPONENTS (from Opponents array)
            // ==========================================
            ExtractGenericOpponents(p, data);

            return p;
        }

        // Helpers
        private OpponentInfo FetchOpponent(string prefix)
        {
            string name = GetProp<string>(prefix + "Name");
            if (string.IsNullOrEmpty(name)) return null;

            return new OpponentInfo
            {
                IsRelevant = true,
                Name = name,
                CarNumber = GetProp<string>(prefix + "CarNumber") ?? "",
                CarName = GetProp<string>(prefix + "CarName") ?? "",
                ClassName = GetProp<string>(prefix + "ClassName") ?? "",
                iRating = GetProp<double>(prefix + "iRating"),
                License = GetProp<string>(prefix + "LicenceString") ?? "",
                SafetyRating = GetProp<string>(prefix + "SafetyRating") ?? "",
                Gap = GetProp<double>(prefix + "RelativeGapToPlayer"),
                LastLapTime = ParseTime(GetProp<string>(prefix + "LastLapTime")),
                PositionInClass = GetProp<string>(prefix + "PositionInClass") ?? "",
                IsInPit = GetProp<bool>(prefix + "IsInPit"),
                TireCompound = GetProp<string>(prefix + "TireCompound") ?? ""
            };
        }

        private double GetSecs(TimeSpan? t)
        {
            return t.HasValue ? t.Value.TotalSeconds : 0;
        }

        private T GetProp<T>(string propertyName)
        {
            var val = this.PluginManager.GetPropertyValue(propertyName);
            if (val == null) return default(T);
            try { return (T)Convert.ChangeType(val, typeof(T)); } catch { return default(T); }
        }

        private double GetCarDamage(GameData data)
        {
            if (data.NewData.CarDamage1 > 0) return data.NewData.CarDamage1;
            return GetProp<double>("IRacingExtraProperties.iRacing_Player_CarDamage");
        }

        private double ParseTime(string timeStr)
        {
            if (string.IsNullOrEmpty(timeStr)) return 0;
            if (double.TryParse(timeStr, out double res)) return res;
            if (TimeSpan.TryParse("0:" + timeStr, out TimeSpan ts)) return ts.TotalSeconds;
            return 0;
        }

        private void SendPacket(TelemetryPacket packet)
        {
            string json = JsonConvert.SerializeObject(packet, jsonSettings);
            byte[] bytes = Encoding.UTF8.GetBytes(json);
            udp.Send(bytes, bytes.Length, TARGET_IP, TARGET_PORT);
        }

        // === NUEVO: Extraer oponentes genéricos del array de Opponents (SimHub nativo) ===
        private void ExtractGenericOpponents(TelemetryPacket p, GameData data)
        {
            var opponents = data.NewData.Opponents;
            if (opponents == null || opponents.Count == 0) return;

            int playerPosition = data.NewData.Position;
            
            // Buscar rival inmediatamente delante (Position == playerPosition - 1)
            if (playerPosition > 1)
            {
                foreach (var opp in opponents)
                {
                    if (opp.Position == playerPosition - 1)
                    {
                        p.OpponentAhead = new OpponentInfo
                        {
                            Name = opp.Name ?? "Unknown",
                            CarNumber = opp.CarNumber ?? "",
                            Gap = opp.RelativeGapToPlayer ?? 0,
                            LastLapTime = ParseTime(opp.LastLapTime.ToString()),
                            IsRelevant = true
                        };
                        break;
                    }
                }
            }

            // Buscar rival inmediatamente detrás (Position == playerPosition + 1)
            foreach (var opp in opponents)
            {
                if (opp.Position == playerPosition + 1)
                {
                    p.OpponentBehind = new OpponentInfo
                    {
                        Name = opp.Name ?? "Unknown",
                        CarNumber = opp.CarNumber ?? "",
                        Gap = -(opp.RelativeGapToPlayer ?? 0), // Negativo porque está detrás
                        LastLapTime = ParseTime(opp.LastLapTime.ToString()),
                        IsRelevant = true
                    };
                    break;
                }
            }

            // Buscar líder (Position == 1)
            foreach (var opp in opponents)
            {
                if (opp.Position == 1)
                {
                    p.Leader = new OpponentInfo
                    {
                        Name = opp.Name ?? "Unknown",
                        CarNumber = opp.CarNumber ?? "",
                        Gap = 0,
                        LastLapTime = ParseTime(opp.LastLapTime.ToString()),
                        IsRelevant = true
                    };
                    p.GapToLeader = opp.RelativeGapToPlayer ?? 0;
                    break;
                }
            }
        }
    }
}