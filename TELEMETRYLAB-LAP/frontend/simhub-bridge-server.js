/**
 * SimHub WebSocket Bridge
 * 
 * Este servidor actúa como puente entre SimHub (TCP) y Telemetry Lab (WebSocket).
 * 
 * Uso:
 * 1. npm install ws
 * 2. node simhub-bridge-server.js
 * 3. Configurar SimHub para enviar datos a localhost:50000 (TCP)
 * 4. Telemetry Lab se conectará a ws://localhost:8888
 */

const WebSocket = require('ws');
const net = require('net');

// Configuración
const CONFIG = {
  wsPort: 8888,           // Puerto WebSocket para Telemetry Lab
  tcpPort: 50000,         // Puerto TCP para recibir de SimHub
  sendInterval: 50,       // Enviar datos cada 50ms (20Hz)
  reconnectDelay: 5000,   // Reintentar conexión cada 5s
};

// Estado
let connectedClients = [];
let lastSendTime = 0;
let simhubConnected = false;

// === WEBSOCKET SERVER (para Telemetry Lab) ===
console.log(`🚀 Iniciando WebSocket Server en puerto ${CONFIG.wsPort}...`);
const wss = new WebSocket.Server({ port: CONFIG.wsPort });

wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  console.log(`✅ Cliente conectado: ${clientIp}`);
  connectedClients.push(ws);
  
  // Enviar estado inicial
  ws.send(JSON.stringify({ 
    type: 'status', 
    connected: simhubConnected,
    message: simhubConnected ? 'Connected to SimHub' : 'Waiting for SimHub...'
  }));
  
  ws.on('close', () => {
    connectedClients = connectedClients.filter(client => client !== ws);
    console.log(`🔴 Cliente desconectado: ${clientIp}`);
  });
  
  ws.on('error', (error) => {
    console.error('❌ Error WebSocket:', error.message);
  });
});

console.log(`✅ WebSocket Server listo en ws://localhost:${CONFIG.wsPort}`);

// === TCP CLIENT (para SimHub) ===
let simhubClient = null;

function connectToSimHub() {
  console.log(`📡 Conectando a SimHub en localhost:${CONFIG.tcpPort}...`);
  
  simhubClient = new net.Socket();
  
  simhubClient.connect(CONFIG.tcpPort, 'localhost', () => {
    console.log('✅ Conectado a SimHub');
    simhubConnected = true;
    
    // Notificar a todos los clientes
    broadcastStatus(true, 'Connected to SimHub');
  });
  
  simhubClient.on('data', (data) => {
    handleSimHubData(data);
  });
  
  simhubClient.on('close', () => {
    console.log('🔴 Desconectado de SimHub');
    simhubConnected = false;
    broadcastStatus(false, 'Disconnected from SimHub');
    
    // Reintentar conexión
    setTimeout(connectToSimHub, CONFIG.reconnectDelay);
  });
  
  simhubClient.on('error', (error) => {
    console.error('❌ Error TCP:', error.message);
    simhubConnected = false;
  });
}

// === PROCESAMIENTO DE DATOS ===
function handleSimHubData(data) {
  const now = Date.now();
  
  // Throttling: Solo enviar cada X ms
  if (now - lastSendTime < CONFIG.sendInterval) {
    return;
  }
  
  lastSendTime = now;
  
  try {
    const message = data.toString().trim();
    
    // SimHub puede enviar múltiples JSON separados por newline
    const lines = message.split('\n');
    
    lines.forEach(line => {
      if (!line.trim()) return;
      
      try {
        const json = JSON.parse(line);
        
        // Validar datos antes de enviar
        if (isValidTelemetry(json)) {
          broadcastData(json);
        }
      } catch (parseError) {
        // Ignorar líneas que no son JSON válido
      }
    });
  } catch (error) {
    console.error('❌ Error procesando datos:', error.message);
  }
}

function isValidTelemetry(data) {
  // Filtrar datos inválidos
  if (!data) return false;
  
  // Debe tener al menos velocidad o RPM
  if (data.Speed === undefined && data.SpeedKmh === undefined && data.RPM === undefined) {
    return false;
  }
  
  // Opcional: Filtrar si no está en pista
  if (data.IsOnTrack === false || data.IsOnTrack === 0) {
    return false;
  }
  
  return true;
}

// === BROADCAST ===
function broadcastData(data) {
  const payload = JSON.stringify(data);
  
  connectedClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(payload);
      } catch (error) {
        console.error('❌ Error enviando datos a cliente:', error.message);
      }
    }
  });
}

function broadcastStatus(connected, message) {
  const payload = JSON.stringify({
    type: 'status',
    connected,
    message,
    timestamp: Date.now(),
  });
  
  connectedClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(payload);
      } catch (error) {
        console.error('❌ Error enviando status:', error.message);
      }
    }
  });
}

// === STATS ===
function logStats() {
  console.log(`
📊 Stats:
   - Clientes conectados: ${connectedClients.length}
   - SimHub: ${simhubConnected ? '🟢 Conectado' : '🔴 Desconectado'}
   - Puerto WebSocket: ${CONFIG.wsPort}
   - Puerto TCP: ${CONFIG.tcpPort}
  `);
}

// Mostrar stats cada 30 segundos
setInterval(logStats, 30000);

// === INICIO ===
connectToSimHub();

// Manejar cierre graceful
process.on('SIGINT', () => {
  console.log('\n🛑 Cerrando servidor...');
  
  if (simhubClient) {
    simhubClient.destroy();
  }
  
  connectedClients.forEach(client => {
    client.close();
  });
  
  wss.close(() => {
    console.log('✅ Servidor cerrado');
    process.exit(0);
  });
});

console.log('\n✨ Bridge activo. Presiona Ctrl+C para detener.\n');
