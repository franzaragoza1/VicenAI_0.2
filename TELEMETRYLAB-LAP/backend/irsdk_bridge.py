"""
iRacing WebSocket Bridge - TELEMETRY-LAB2
Backend con pyirsdk compatible con frontend React de TELEMETRY-LABV1
"""
import asyncio
import websockets
import json
import sys
import time

try:
    import irsdk
    IRSDK_AVAILABLE = True
except ImportError:
    IRSDK_AVAILABLE = False
    print("[ERROR] pyirsdk no instalado. Ejecuta: pip install pyirsdk")
    sys.exit(1)


class IRacingBridge:
    """Extrae telemetría de iRacing y la normaliza para el frontend"""
    
    def __init__(self):
        self.ir = irsdk.IRSDK()
        self.connected = False
        self.reconnect_attempts = 0
    
    def try_connect(self):
        """Intenta conectar a iRacing"""
        try:
            if self.ir.startup():
                if self.ir.is_initialized and self.ir.is_connected:
                    self.connected = True
                    self.reconnect_attempts = 0
                    print("[OK] iRacing connected")
                    return True
        except Exception as e:
            if self.reconnect_attempts % 200 == 0:
                print(f"[INFO] Waiting for iRacing... (attempt {self.reconnect_attempts})")
        
        self.reconnect_attempts += 1
        self.connected = False
        return False
    
    def get_telemetry_point(self):
        """
        Extrae datos de iRacing y los convierte al formato del frontend:
        {
            distancePct: float,  // 0.0-1.0
            speed: float,        // km/h
            throttle: float,     // 0.0-1.0
            brake: float,        // 0.0-1.0
            gear: int,           // 0, 1-8
            rpm: float,          // RPM
            steeringWheelAngle: float,  // rad
            trackName: string,   // Nombre del circuito con layout
            carName: string      // Nombre del coche
        }
        """
        # Reconectar si no está conectado
        if not self.connected:
            self.try_connect()
        
        if self.connected and self.ir:
            try:
                # Verificar que sigue conectado
                if not self.ir.is_initialized or not self.ir.is_connected:
                    self.connected = False
                    return self.get_empty_data()
                
                # Extraer datos de iRacing
                speed_ms = self.ir['Speed'] or 0
                speed_kmh = speed_ms * 3.6  # m/s a km/h
                
                throttle = self.ir['Throttle'] or 0  # Ya viene 0-1
                brake = self.ir['Brake'] or 0        # Ya viene 0-1
                gear = self.ir['Gear'] or 0
                rpm = self.ir['RPM'] or 0
                lap_dist_pct = self.ir['LapDistPct'] or 0
                steering_angle = self.ir['SteeringWheelAngle'] or 0  # En radianes
                
                # Extraer metadata del circuito y coche (solo primera vez para evitar lookups constantes)
                try:
                    weekend_info = self.ir['WeekendInfo']
                    track_display_name = weekend_info['TrackDisplayName'] if weekend_info and 'TrackDisplayName' in weekend_info else 'Unknown Track'
                    track_config_name = weekend_info['TrackConfigName'] if weekend_info and 'TrackConfigName' in weekend_info else ''
                    
                    # Combinar nombre del circuito con layout
                    if track_config_name and track_config_name.strip():
                        track_name = f"{track_display_name} - {track_config_name}"
                    else:
                        track_name = track_display_name
                    
                    driver_info = self.ir['DriverInfo']
                    if driver_info and 'Drivers' in driver_info:
                        player_idx = self.ir['DriverInfo']['DriverCarIdx']
                        car_name = driver_info['Drivers'][player_idx]['CarScreenName']
                    else:
                        car_name = 'Unknown Car'
                except:
                    track_name = 'Unknown Track'
                    car_name = 'Unknown Car'
                
                return {
                    'distancePct': float(lap_dist_pct),
                    'speed': float(speed_kmh),
                    'throttle': float(throttle),
                    'brake': float(brake),
                    'gear': int(gear),
                    'rpm': float(rpm),
                    'steeringWheelAngle': float(steering_angle),
                    'trackName': str(track_name),
                    'carName': str(car_name),
                    'timestamp': int(time.time() * 1000)
                }
            
            except Exception as e:
                print(f"[ERROR] Reading telemetry: {e}")
                self.connected = False
                return self.get_empty_data()
        
        return self.get_empty_data()
    
    def get_empty_data(self):
        """Datos vacíos cuando no está conectado"""
        return {
            'distancePct': 0.0,
            'speed': 0.0,
            'throttle': 0.0,
            'brake': 0.0,
            'gear': 0,
            'rpm': 0.0,
            'steeringWheelAngle': 0.0,
            'trackName': 'Not Connected',
            'carName': 'Not Connected',
            'timestamp': int(time.time() * 1000)
        }
    
    def shutdown(self):
        """Cierra conexión a iRacing"""
        if self.ir:
            try:
                self.ir.shutdown()
            except:
                pass


class WebSocketServer:
    """Servidor WebSocket que transmite telemetría al frontend"""
    
    def __init__(self, port=8887):
        self.port = port
        self.bridge = IRacingBridge()
        self.clients = set()
        self.running = True
    
    async def broadcast_telemetry(self):
        """Transmite telemetría a 20Hz"""
        while self.running:
            try:
                data = self.bridge.get_telemetry_point()
                message = json.dumps(data)
                
                # Enviar a todos los clientes conectados
                if self.clients:
                    disconnected = set()
                    for client in self.clients:
                        try:
                            await client.send(message)
                        except Exception:
                            disconnected.add(client)
                    
                    for client in disconnected:
                        self.clients.discard(client)
                
                await asyncio.sleep(0.05)  # 20Hz
            
            except Exception as e:
                print(f"[ERROR] Broadcast: {e}")
                await asyncio.sleep(0.1)
    
    async def handle_client(self, websocket):
        """Maneja conexión de un cliente"""
        self.clients.add(websocket)
        
        try:
            client_ip = websocket.remote_address[0] if websocket.remote_address else "unknown"
            print(f"[+] Client connected: {client_ip} (total: {len(self.clients)})")
        except:
            print("[+] Client connected")
        
        try:
            # Enviar estado inicial
            status = {
                'type': 'status',
                'connected': self.bridge.connected,
                'message': 'Connected to iRacing' if self.bridge.connected else 'Waiting for iRacing...'
            }
            await websocket.send(json.dumps(status))
            
            # Mantener conexión abierta
            async for _ in websocket:
                pass
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            self.clients.discard(websocket)
            print(f"[-] Client disconnected (total: {len(self.clients)})")
    
    async def start(self):
        """Inicia el servidor"""
        print("="*70)
        print("iRacing WebSocket Bridge - TELEMETRY-LAB2")
        print("="*70)
        print(f"[*] WebSocket server: ws://0.0.0.0:{self.port}")
        
        async with websockets.serve(self.handle_client, "0.0.0.0", self.port):
            print(f"[OK] Server ready - Broadcasting at 20Hz")
            print(f"[*] Frontend URL: ws://localhost:{self.port}")
            print("="*70)
            sys.stdout.flush()
            
            broadcast_task = asyncio.create_task(self.broadcast_telemetry())
            
            try:
                await asyncio.Future()
            except asyncio.CancelledError:
                self.running = False
                broadcast_task.cancel()
                try:
                    await broadcast_task
                except asyncio.CancelledError:
                    pass
    
    def run(self):
        """Ejecuta el servidor"""
        try:
            asyncio.run(self.start())
        except KeyboardInterrupt:
            print("\n[STOP] Shutting down...")
            self.running = False
            self.bridge.shutdown()
        except Exception as e:
            print(f"[FATAL] {e}")
            import traceback
            traceback.print_exc()
            self.bridge.shutdown()


if __name__ == "__main__":
    server = WebSocketServer(port=8887)
    server.run()
