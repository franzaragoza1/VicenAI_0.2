import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { uIOhook, UiohookKey } from 'uiohook-napi';
// import dgram from 'dgram';  // DISABLED FOR TEST

const app = express();
const httpServer = createServer(app);

// UDP Server DISABLED
// const udpServer = dgram.createSocket('udp4');
// udpServer.on('message', (msg) => {
//   console.log('UDP:', msg.toString().substring(0, 50));
// });
// udpServer.bind(9999);
// console.log('UDP listening on 9999');

// Rutas API
app.get('/api/test', (req, res) => {
  res.json({ status: 'ok' });
});

// WebSocket principal
const wss = new WebSocketServer({ 
  server: httpServer, 
  path: '/'
});

// WebSocket secundario (telemetry) - DISABLED
// const telemetryWss = new WebSocketServer({ 
//   server: httpServer, 
//   path: '/telemetry'
// });

wss.on('connection', (ws: WebSocket) => {
  console.log('Client connected to /');
  
  setTimeout(() => {
    ws.send(JSON.stringify({ type: 'CONNECTED' }));
    console.log('Sent welcome');
  }, 100);
  
  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

// telemetryWss.on('connection', (ws: WebSocket) => {
//   console.log('Client connected to /telemetry');
// });

// Test uiohook
uIOhook.on('keydown', (e) => {
  if (e.keycode === UiohookKey.F13) {
    console.log('F13 pressed');
  }
});
uIOhook.start();
console.log('uIOhook started');

httpServer.listen(8081, () => {
  console.log('Test server FULL on 8081');
});
