/**
 * PTT Global via HID - Funciona SIN foco de ventana
 * Lee inputs directamente del volante Logitech u otros dispositivos HID
 */

import HID from 'node-hid';

export interface PTTConfig {
  vendorId: number;
  productId: number;
  buttonByteOffset: number;  // Byte donde está el botón (ej: 1)
  buttonBitIndex: number;    // Bit dentro del byte (ej: 5)
  deviceName?: string;
}

export interface PTTEventCallback {
  onPress: () => void;
  onRelease: () => void;
}

// Logitech conocidos (VendorID = 0x046d)
const LOGITECH_VENDOR_ID = 0x046d;

// Fanatec conocidos (VendorID = 0x0eb7)
const FANATEC_VENDOR_ID = 0x0eb7;

// Mapeo de productos Logitech conocidos
const LOGITECH_PRODUCTS: Record<number, string> = {
  0xc24f: 'G29 Driving Force Racing Wheel',
  0xc260: 'G29 Shifter',
  0xc262: 'G920 Driving Force Racing Wheel',
  0xc266: 'G923 Racing Wheel (PS)',
  0xc267: 'G923 Racing Wheel (Xbox)',
  0xc299: 'G25 Racing Wheel',
  0xc29a: 'G27 Racing Wheel',
  0xc29b: 'G27 Racing Wheel LED',
};

// Mapeo de productos Fanatec conocidos
const FANATEC_PRODUCTS: Record<number, string> = {
  0x0001: 'ClubSport Wheel Base',
  0x0003: 'CSL Elite Wheel Base',
  0x0004: 'ClubSport Wheel Base V2',
  0x0005: 'ClubSport Wheel Base V2.5',
  0x0006: 'Podium Wheel Base DD1',
  0x0007: 'Podium Wheel Base DD2',
  0x0008: 'CSL DD',
  0x0011: 'GT DD Pro',
  0x0020: 'ClubSport Pedals V3',
  0x0021: 'CSL Elite Pedals',
  0x0022: 'CSL Pedals',
  0x0023: 'ClubSport Pedals V3 Inverted',
  0x0030: 'ClubSport Shifter SQ V1.5',
  0x0031: 'ClubSport Static Shifter Paddles',
  0x0032: 'Podium Button Module Endurance',
  0x0033: 'Podium Advanced Paddle Module',
  0x0034: 'CSL Elite Steering Wheel McLaren GT3',
  0x0035: 'ClubSport Steering Wheel F1',
  0x0036: 'ClubSport Steering Wheel BMW GT2',
  0x0e03: 'CSL Elite Wheel Base+ (PS4)',
};

export class PTTHidService {
  private device: HID.HID | null = null;
  private config: PTTConfig | null = null;
  private callbacks: PTTEventCallback | null = null;
  private lastButtonState = false;
  private isRunning = false;
  
  // Debounce para evitar rebotes del botón
  private lastPressTime = 0;
  private lastReleaseTime = 0;
  private readonly DEBOUNCE_MS = 100; // 100ms de debounce

  /**
   * Lista todos los dispositivos HID disponibles
   */
  public listDevices(): HID.Device[] {
    try {
      const devices = HID.devices();
      console.log(`[PTT-HID] ${devices.length} dispositivos HID encontrados`);
      return devices;
    } catch (error) {
      console.error('[PTT-HID] Error listando dispositivos:', error);
      return [];
    }
  }

  /**
   * Busca volantes Logitech conectados
   */
  public findLogitechWheels(): HID.Device[] {
    const devices = this.listDevices();
    const logitechDevices = devices.filter(d => d.vendorId === LOGITECH_VENDOR_ID);
    
    console.log(`[PTT-HID] Dispositivos Logitech encontrados:`);
    logitechDevices.forEach(d => {
      const knownName = LOGITECH_PRODUCTS[d.productId] || 'Desconocido';
      console.log(`  - ${d.product || knownName} (VID:${d.vendorId.toString(16)} PID:${d.productId.toString(16)})`);
      console.log(`    Path: ${d.path}`);
      console.log(`    UsagePage: ${d.usagePage}, Usage: ${d.usage}`);
    });
    
    return logitechDevices;
  }

  /**
   * Busca dispositivos Fanatec conectados (bases, volantes, pedales)
   */
  public findFanatecDevices(): HID.Device[] {
    const devices = this.listDevices();
    const fanatecDevices = devices.filter(d => d.vendorId === FANATEC_VENDOR_ID);
    
    console.log(`[PTT-HID] Dispositivos Fanatec encontrados:`);
    fanatecDevices.forEach(d => {
      const knownName = FANATEC_PRODUCTS[d.productId] || 'Desconocido';
      console.log(`  - ${d.product || knownName} (VID:${d.vendorId.toString(16)} PID:${d.productId.toString(16)})`);
      console.log(`    Path: ${d.path}`);
      console.log(`    UsagePage: ${d.usagePage}, Usage: ${d.usage}`);
    });
    
    return fanatecDevices;
  }

  /**
   * Busca cualquier volante/gamepad conocido (Fanatec, Logitech, etc.)
   */
  public findAllWheels(): HID.Device[] {
    const devices = this.listDevices();
    const wheelDevices = devices.filter(d => 
      d.vendorId === FANATEC_VENDOR_ID || 
      d.vendorId === LOGITECH_VENDOR_ID
    );
    
    console.log(`[PTT-HID] Dispositivos de sim racing encontrados:`);
    wheelDevices.forEach(d => {
      let brand = 'Desconocido';
      let knownName = 'Dispositivo HID';
      
      if (d.vendorId === FANATEC_VENDOR_ID) {
        brand = 'Fanatec';
        knownName = FANATEC_PRODUCTS[d.productId] || 'Dispositivo Fanatec';
      } else if (d.vendorId === LOGITECH_VENDOR_ID) {
        brand = 'Logitech';
        knownName = LOGITECH_PRODUCTS[d.productId] || 'Dispositivo Logitech';
      }
      
      console.log(`  - [${brand}] ${d.product || knownName} (VID:${d.vendorId.toString(16)} PID:${d.productId.toString(16)})`);
      console.log(`    Path: ${d.path}`);
      console.log(`    UsagePage: ${d.usagePage}, Usage: ${d.usage}`);
    });
    
    return wheelDevices;
  }

  /**
   * Configura el dispositivo PTT
   */
  public configure(config: PTTConfig): boolean {
    this.config = config;
    console.log(`[PTT-HID] Configurado: VID=${config.vendorId.toString(16)} PID=${config.productId.toString(16)} Byte=${config.buttonByteOffset} Bit=${config.buttonBitIndex}`);
    return true;
  }

  /**
   * Inicia la escucha del dispositivo HID
   */
  public start(callbacks: PTTEventCallback): boolean {
    if (!this.config) {
      console.error('[PTT-HID] No hay configuración. Usa configure() primero.');
      return false;
    }

    this.callbacks = callbacks;

    try {
      // Buscar el dispositivo correcto (preferir el que tiene usagePage de gamecontroller)
      const devices = HID.devices();
      const candidates = devices.filter(d => 
        d.vendorId === this.config!.vendorId && 
        d.productId === this.config!.productId
      );

      if (candidates.length === 0) {
        console.error('[PTT-HID] Dispositivo no encontrado');
        return false;
      }

      // Preferir dispositivo con usagePage 1 (Generic Desktop) y usage 4 (Joystick)
      const preferredDevice = candidates.find(d => d.usagePage === 1 && d.usage === 4) 
        || candidates.find(d => d.usagePage === 1)
        || candidates[0];

      if (!preferredDevice.path) {
        console.error('[PTT-HID] Dispositivo sin path válido');
        return false;
      }

      console.log(`[PTT-HID] Abriendo: ${preferredDevice.product || 'HID Device'}`);
      console.log(`  Path: ${preferredDevice.path}`);

      this.device = new HID.HID(preferredDevice.path);
      this.isRunning = true;

      // Escuchar reportes de entrada
      this.device.on('data', (data: Buffer) => {
        this.handleInputReport(data);
      });

      this.device.on('error', (err: Error) => {
        console.error('[PTT-HID] Error:', err.message);
        this.stop();
      });

      console.log(`[PTT-HID] ✅ Escuchando botón (byte ${this.config.buttonByteOffset}, bit ${this.config.buttonBitIndex}) para PTT`);
      return true;

    } catch (error: any) {
      console.error('[PTT-HID] Error abriendo dispositivo:', error.message);
      
      if (error.message.includes('cannot open device')) {
        console.error('[PTT-HID] 💡 TIP: El dispositivo puede estar siendo usado por otro programa.');
        console.error('[PTT-HID] 💡 TIP: En Windows, intenta ejecutar como Administrador.');
      }
      
      return false;
    }
  }

  /**
   * Procesa un reporte de entrada HID
   * Usa buttonByteOffset y buttonBitIndex directamente
   */
  private handleInputReport(data: Buffer): void {
    if (!this.config || !this.callbacks) return;

    const byteOffset = this.config.buttonByteOffset;
    const bitIndex = this.config.buttonBitIndex;

    if (byteOffset >= data.length) {
      return;
    }

    const isPressed = (data[byteOffset] & (1 << bitIndex)) !== 0;
    this.processButtonState(isPressed);
  }

  /**
   * Procesa el estado del botón y emite eventos con debounce
   */
  private processButtonState(isPressed: boolean): void {
    if (!this.callbacks) return;

    const now = Date.now();

    // Rising edge: botón presionado
    if (isPressed && !this.lastButtonState) {
      // Debounce: ignorar si pasó muy poco tiempo desde el último press
      if (now - this.lastPressTime < this.DEBOUNCE_MS) {
        return;
      }
      this.lastPressTime = now;
      console.log('[PTT-HID] 🎙️ PTT ACTIVADO');
      this.callbacks.onPress();
    }
    // Falling edge: botón liberado
    else if (!isPressed && this.lastButtonState) {
      // Debounce: ignorar si pasó muy poco tiempo desde el último release
      if (now - this.lastReleaseTime < this.DEBOUNCE_MS) {
        return;
      }
      this.lastReleaseTime = now;
      console.log('[PTT-HID] 🔇 PTT DESACTIVADO');
      this.callbacks.onRelease();
    }

    this.lastButtonState = isPressed;
  }

  /**
   * Detiene la escucha
   */
  public stop(): void {
    if (this.device) {
      try {
        this.device.close();
      } catch (e) {
        // Ignorar errores al cerrar
      }
      this.device = null;
    }
    this.isRunning = false;
    this.lastButtonState = false;
    console.log('[PTT-HID] Detenido');
  }

  /**
   * Verifica si está activo
   */
  public isActive(): boolean {
    return this.isRunning && this.device !== null;
  }

  /**
   * Obtiene información del dispositivo actual
   */
  public getDeviceInfo(): { vendorId: number; productId: number; name: string } | null {
    if (!this.config) return null;
    return {
      vendorId: this.config.vendorId,
      productId: this.config.productId,
      name: this.config.deviceName || LOGITECH_PRODUCTS[this.config.productId] || 'HID Device'
    };
  }
}

// Singleton para uso global
export const pttHidService = new PTTHidService();

// Script de diagnóstico si se ejecuta directamente
if (process.argv[1]?.endsWith('ptt-hid.ts') || process.argv[1]?.endsWith('ptt-hid.js')) {
  console.log('=== PTT HID Diagnostic ===\n');
  
  const service = new PTTHidService();
  const wheels = service.findLogitechWheels();
  
  if (wheels.length > 0) {
    const wheel = wheels.find(w => w.usagePage === 1) || wheels[0];
    console.log(`\nProbando con: ${wheel.product || 'Logitech Device'}`);
    
    service.configure({
      vendorId: wheel.vendorId,
      productId: wheel.productId,
      buttonByteOffset: 1,  // Typical button byte
      buttonBitIndex: 5,    // Typical button bit
      deviceName: wheel.product || undefined
    });
    
    const started = service.start({
      onPress: () => console.log('>>> BOTÓN PRESIONADO <<<'),
      onRelease: () => console.log('>>> BOTÓN LIBERADO <<<')
    });
    
    if (started) {
      console.log('\nEscuchando... Presiona Ctrl+C para salir.\n');
      
      process.on('SIGINT', () => {
        service.stop();
        process.exit(0);
      });
    }
  } else {
    console.log('No se encontraron volantes Logitech.');
  }
}
