const WebSocket = require('ws');

console.log('🚀 Iniciando SimHub Mock Server...');

// Crear servidor WebSocket en puerto 9999
const wss = new WebSocket.Server({ port: 9999 });

console.log('✅ SimHub Mock Server ejecutándose en ws://localhost:9999');
console.log('📡 Esperando conexiones de Telemetry Lab...');

// Datos de ejemplo que simula SimHub
const mockTelemetryData = {
  SpeedKmh: 0,
  Rpms: 800,
  Gear: 1,
  Throttle: 0,
  Brake: 0,
  TrackPositionPercent: 0,
  IsOnTrack: 1
};

// Simular una vuelta completa
let lapProgress = 0;
const lapDuration = 60000; // 60 segundos por vuelta
let startTime = Date.now();

function generateRealisticData() {
  const elapsed = Date.now() - startTime;
  const progress = (elapsed % lapDuration) / lapDuration; // 0 a 1
  
  // Simular diferentes secciones de la pista
  let speed, throttle, brake, gear, rpm;
  
  if (progress < 0.2) {
    // Recta principal - alta velocidad
    speed = 180 + Math.sin(progress * 10) * 20;
    throttle = 95 + Math.random() * 5;
    brake = 0;
    gear = 6;
    rpm = 7500 + Math.random() * 500;
  } else if (progress < 0.4) {
    // Frenada para curva
    const brakePhase = (progress - 0.2) / 0.2;
    speed = 180 - brakePhase * 120; // De 180 a 60
    throttle = Math.max(0, 95 - brakePhase * 95);
    brake = brakePhase * 100;
    gear = Math.max(2, 6 - Math.floor(brakePhase * 4));
    rpm = 7500 - brakePhase * 3000;
  } else if (progress < 0.6) {
    // Curva lenta
    speed = 60 + Math.sin((progress - 0.4) * 20) * 10;
    throttle = 30 + Math.random() * 20;
    brake = Math.random() * 10;
    gear = 2;
    rpm = 4000 + Math.random() * 1000;
  } else if (progress < 0.8) {
    // Aceleración salida curva
    const accelPhase = (progress - 0.6) / 0.2;
    speed = 60 + accelPhase * 90; // De 60 a 150
    throttle = 40 + accelPhase * 55;
    brake = 0;
    gear = Math.min(5, 2 + Math.floor(accelPhase * 3));
    rpm = 4000 + accelPhase * 3500;
  } else {
    // Recta final
    speed = 150 + (progress - 0.8) * 150; // De 150 a 180
    throttle = 90 + Math.random() * 10;
    brake = 0;
    gear = Math.min(6, 5 + Math.floor((progress - 0.8) * 5));
    rpm = 7000 + Math.random() * 1000;
  }

  return {
    SpeedKmh: Math.round(speed * 10) / 10,
    Rpms: Math.round(rpm),
    Gear: gear,
    Throttle: Math.round(throttle * 10) / 10,
    Brake: Math.round(brake * 10) / 10,
    TrackPositionPercent: Math.round(progress * 1000) / 1000,
    IsOnTrack: 1
  };
}

wss.on('connection', function connection(ws) {
  console.log('🔌 Cliente conectado desde Telemetry Lab');
  
  // Enviar datos cada 100ms (10Hz)
  const interval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      const data = generateRealisticData();
      ws.send(JSON.stringify(data));
      
      // Log ocasional para debug
      if (Math.random() < 0.01) { // 1% de probabilidad
        console.log('📊 Enviando:', data);
      }
    }
  }, 100);

  ws.on('close', () => {
    console.log('🔌 Cliente desconectado');
    clearInterval(interval);
  });

  ws.on('error', (error) => {
    console.error('❌ Error WebSocket:', error);
    clearInterval(interval);
  });
});

// Manejo de cierre del servidor
process.on('SIGINT', () => {
  console.log('\n🛑 Cerrando SimHub Mock Server...');
  wss.close(() => {
    console.log('✅ Servidor cerrado');
    process.exit(0);
  });
});

console.log('💡 Presiona Ctrl+C para detener el servidor');
console.log('🎮 En Telemetry Lab: cambia a modo "🔴 Live" para ver los datos');