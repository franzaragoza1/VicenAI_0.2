/**
 * Script de diagnóstico para volante Logitech PTT
 * Ejecutar: node server/dist/test-ptt-hid.js
 */

import { pttHidService } from './ptt-hid.js';

console.log('═══════════════════════════════════════════════════════════════');
console.log('  🏎️  DIAGNÓSTICO PTT - VOLANTE FANATEC / LOGITECH');
console.log('═══════════════════════════════════════════════════════════════\n');

// 1. Listar todos los dispositivos HID
console.log('📋 PASO 1: Listando todos los dispositivos HID...\n');
const allDevices = pttHidService.listDevices();
console.log(`   Total: ${allDevices.length} dispositivos\n`);

// 2. Buscar dispositivos de sim racing (Fanatec + Logitech)
console.log('📋 PASO 2: Buscando dispositivos de sim racing...\n');
const wheelDevices = pttHidService.findAllWheels();

// También buscar Fanatec específicamente
const fanatecDevices = pttHidService.findFanatecDevices();

if (wheelDevices.length === 0) {
  console.log('❌ No se encontraron volantes Fanatec o Logitech conectados.\n');
  console.log('💡 Posibles soluciones:');
  console.log('   1. Asegúrate de que el volante está conectado por USB');
  console.log('   2. Verifica que los drivers de Fanatec están instalados');
  console.log('   3. Intenta ejecutar como Administrador');
  console.log('   4. Desconecta y vuelve a conectar el volante\n');
  process.exit(1);
}

// 3. Seleccionar el dispositivo (preferir Fanatec con botones)
// Para Fanatec, los botones suelen estar en el volante (no en la base ni pedales)
const wheel = fanatecDevices.find(d => d.usagePage === 1 && (d.usage === 4 || d.usage === 5)) || 
              fanatecDevices.find(d => d.usagePage === 1) ||
              wheelDevices.find(d => d.usagePage === 1 && d.usage === 4) ||
              wheelDevices[0];

console.log(`\n✅ Dispositivo seleccionado: ${wheel.product || 'Sim Racing Device'}`);
console.log(`   VendorID:  0x${wheel.vendorId.toString(16).padStart(4, '0')} (${wheel.vendorId})`);
console.log(`   ProductID: 0x${wheel.productId.toString(16).padStart(4, '0')} (${wheel.productId})`);
console.log(`   Path: ${wheel.path}`);

// 4. Probar escucha de botones
console.log('\n📋 PASO 3: Probando escucha de botones...\n');
console.log('   Voy a probar diferentes índices de botón.');
console.log('   Presiona botones en tu volante para ver cuál se detecta.\n');

// Empezar con botón 0
let currentByteOffset = 0;
let currentBitIndex = 0;

function testButton(byteOffset: number, bitIndex: number) {
  console.log(`\n🔍 Probando Byte ${byteOffset}, Bit ${bitIndex}...`);
  
  pttHidService.stop();
  
  pttHidService.configure({
    vendorId: wheel.vendorId,
    productId: wheel.productId,
    buttonByteOffset: byteOffset,
    buttonBitIndex: bitIndex,
    deviceName: wheel.product || undefined
  });

  const started = pttHidService.start({
    onPress: () => {
      console.log(`\n🎯 ¡¡¡ BOTÓN (Byte ${byteOffset}, Bit ${bitIndex}) DETECTADO !!!\n`);
      console.log('═══════════════════════════════════════════════════════════════');
      console.log(`  ✅ CONFIGURACIÓN EXITOSA`);
      console.log('═══════════════════════════════════════════════════════════════');
      console.log(`\n  Para configurar PTT en VICEN, usa:\n`);
      console.log(`  POST http://localhost:8081/api/ptt/configure`);
      console.log(`  {`);
      console.log(`    "vendorId": ${wheel.vendorId},`);
      console.log(`    "productId": ${wheel.productId},`);
      console.log(`    "buttonByteOffset": ${byteOffset},`);
      console.log(`    "buttonBitIndex": ${bitIndex},`);
      console.log(`    "deviceName": "${wheel.product || 'Fanatec Wheel'}"`);
      console.log(`  }\n`);
      
      // Continuar escuchando para confirmar
    },
    onRelease: () => {
      console.log(`   Botón (Byte ${byteOffset}, Bit ${bitIndex}) liberado`);
    }
  });

  if (!started) {
    console.log(`   ⚠️ No se pudo iniciar escucha para botón (Byte ${byteOffset}, Bit ${bitIndex})`);
  }
}

// Modo interactivo
console.log('═══════════════════════════════════════════════════════════════');
console.log('  MODO DE PRUEBA INTERACTIVO');
console.log('═══════════════════════════════════════════════════════════════');
console.log('\n  Para Fanatec, usa el script find-fanatec-button.mjs');
console.log('  Este script es para pruebas básicas.\n');
console.log('  Comandos:');
console.log('  - Escribe "byte,bit" (ej: 1,5) para probar esa combinación');
console.log('  - Escribe "q" para salir\n');

// Empezar con byte 1, bit 5 (el que encontramos para Fanatec)
testButton(1, 5);

// Leer input del usuario
const readline = await import('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.on('line', (input: string) => {
  const trimmed = input.trim().toLowerCase();
  
  if (trimmed === 'q') {
    console.log('\n👋 Cerrando diagnóstico...');
    pttHidService.stop();
    process.exit(0);
  }
  
  // Parsear "byte,bit"
  const parts = trimmed.split(',');
  if (parts.length === 2) {
    const byteOffset = parseInt(parts[0]);
    const bitIndex = parseInt(parts[1]);
    if (!isNaN(byteOffset) && !isNaN(bitIndex)) {
      testButton(byteOffset, bitIndex);
      return;
    }
  }
  
  console.log('  Formato: byte,bit (ej: 1,5)');
});

// Mantener el proceso corriendo
process.on('SIGINT', () => {
  console.log('\n\n👋 Cerrando diagnóstico...');
  pttHidService.stop();
  process.exit(0);
});
