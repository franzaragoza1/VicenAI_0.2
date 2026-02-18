const WebSocket = require('ws');
const dgram = require('dgram');

console.log('🚀 Iniciando SimHub UDP→WebSocket Bridge...');

// Crear servidor UDP para recibir datos del plugin C#
const udpServer = dgram.createSocket('udp4');

// Crear servidor WebSocket para el frontend
const wss = new WebSocket.Server({ port: 8887 });

console.log('✅ UDP Server escuchando en puerto 9999 (plugin C#)');
console.log('✅ WebSocket Server ejecutándose en ws://localhost:8887 (frontend)');
console.log('📡 Esperando conexiones...');

// Almacenar conexiones WebSocket activas
const clients = new Set();

// Manejar nuevas conexiones WebSocket (frontend)
wss.on('connection', function connection(ws) {
  console.log('🔌 Frontend conectado via WebSocket');
  clients.add(ws);
  
  ws.on('close', () => {
    console.log('🔌 Frontend desconectado');
    clients.delete(ws);
  });
  
  ws.on('error', (error) => {
    console.error('❌ Error WebSocket:', error);
    clients.delete(ws);
  });
});

// Manejar datos UDP del plugin C#
udpServer.on('message', (buffer, rinfo) => {
  try {
    // Convertir buffer a string
    const jsonString = buffer.toString('utf8');
    
    // Parsear JSON para validar
    const data = JSON.parse(jsonString);
    
    // Mapear el formato del plugin C# al formato esperado por el frontend
    const mappedData = {
      SpeedKmh: data.SpeedKmh || 0,
      Rpms: data.Rpms || 0,  
      Gear: data.Gear || "N",
      Throttle: data.Throttle || 0,  // Ya viene en 0-100 desde plugin C#
      Brake: data.Brake || 0,        // Ya viene en 0-100 desde plugin C#
      TrackPositionPercent: data.TrackPositionPercent || 0,
      IsOnTrack: !data.IsInPitLane && !data.IsInPit // Derivar de otras variables
    };
    
    // Reenviar a todos los clientes WebSocket conectados
    const message = JSON.stringify(mappedData);
    clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
    
    // Debug eliminado para mejor rendimiento
    
  } catch (error) {
    console.warn('⚠️ Error procesando UDP packet:', error.message);
  }
});

// Iniciar servidor UDP en puerto 9999
udpServer.bind(9999, '127.0.0.1', () => {
  console.log('🎯 UDP Bridge listo - Plugin C# → Frontend');
});

udpServer.on('error', (err) => {
  console.error('❌ Error UDP Server:', err);
});

// Manejo de cierre
process.on('SIGINT', () => {
  console.log('\n🛑 Cerrando UDP→WebSocket Bridge...');
  udpServer.close();
  wss.close(() => {
    console.log('✅ Bridge cerrado');
    process.exit(0);
  });
});

console.log('💡 Presiona Ctrl+C para detener el bridge');
console.log('🎮 1. Ejecuta tu plugin C# de SimHub');
console.log('🎮 2. En Telemetry Lab: cambia a modo "🔴 Live"');