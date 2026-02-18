# Análisis de Problemas de Conexión Gemini Live

## Síntomas Reportados
1. La conexión se cae al poco de empezar la carrera
2. A veces reconecta, a veces no
3. Después de pedir comparar vueltas, Gemini deja de responder
4. Dos voces respondiendo simultáneamente (ya corregido con Singleton)

## Diferencias Críticas: OLD vs ACTUAL

### 1. 🚨 **Proactive Reconnect Timer (NUEVO - NO EXISTE EN OLD)**

**Archivo:** [`gemini-live.ts`](../client/src/services/gemini-live.ts:545-595)

La versión ACTUAL tiene un timer que reconecta proactivamente a los 9 minutos:

```typescript
private proactiveReconnectTimeout: ReturnType<typeof setTimeout> | null = null;
private readonly PROACTIVE_RECONNECT_MS = 9 * 60 * 1000; // 9 minutes

private startProactiveReconnectTimer(): void {
  this.proactiveReconnectTimeout = setTimeout(async () => {
    // Disconnect cleanly
    await this.disconnect();
    // Reconnect with same context
    await this.connect(this.initialContext);
    // Send wake-up message
    await this.sendReconnectionWakeUp();
  }, this.PROACTIVE_RECONNECT_MS);
}
```

**PROBLEMA POTENCIAL:** 
- Este timer puede dispararse durante una carrera activa
- Si hay un error durante la reconexión, puede dejar la conexión en estado inconsistente
- El `disconnect()` limpia el singleton pero el timer sigue activo

### 2. 🚨 **Manejo de compare_laps (DIFERENTE)**

**OLD (líneas 1768-1859):**
```typescript
// Envía tool response y luego imagen directamente
this.session.sendToolResponse({...});
this.session.sendClientContent({
  turns: [{ role: "user", parts: [{ inlineData: {...}, text: analysisPrompt }] }],
  turnComplete: true,
});
```

**ACTUAL (líneas 2203-2324):**
```typescript
// Añade múltiples guards pero puede fallar silenciosamente
if (!this.isSessionReady()) {
  console.error('[CompareLaps] ❌ Session not ready, cannot send image');
  return; // ⚠️ NO ENVÍA RESPUESTA A GEMINI
}

try {
  this.session.sendToolResponse({...});
} catch (toolErr) {
  console.error('[CompareLaps] ❌ Error sending tool response:', toolErr);
  return; // ⚠️ NO ENVÍA RESPUESTA A GEMINI
}

// Re-check session before sending image
if (!this.isSessionReady()) {
  console.error('[CompareLaps] ❌ Session lost before sending image');
  return; // ⚠️ NO ENVÍA RESPUESTA A GEMINI
}
```

**PROBLEMA CRÍTICO:**
- Si la sesión se pierde entre el `sendToolResponse` y el `sendClientContent`, Gemini queda esperando la imagen
- Gemini Live tiene un timeout interno - si no recibe la imagen, puede cerrar la conexión
- Los `return` silenciosos dejan a Gemini en estado de espera indefinido

### 3. 🚨 **Herramientas de Pit Stop (NUEVAS - NO EXISTEN EN OLD)**

**Archivo:** [`gemini-live.ts`](../client/src/services/gemini-live.ts:155-223)

La versión ACTUAL añade:
- `configure_pit_stop`
- `get_pit_status`
- `send_chat_macro`

Estas herramientas usan un WebSocket separado (`commandWs`) para comunicarse con el servidor:

```typescript
private commandWs: WebSocket | null = null;
private pendingCommandCallbacks = new Map<string, {...}>();

private ensureCommandWs(): Promise<WebSocket> {
  // Crea conexión WebSocket a ws://localhost:8080
}
```

**PROBLEMA POTENCIAL:**
- Si el servidor no responde, el timeout de 5 segundos puede bloquear
- Los callbacks pendientes pueden acumularse si hay errores
- No hay limpieza de `commandWs` en `disconnect()`

### 4. 🚨 **AudioWorklet vs ScriptProcessor**

**OLD:** Usa solo `ScriptProcessorNode` (deprecated pero estable)

**ACTUAL:** Intenta usar `AudioWorkletNode` con fallback:
```typescript
private workletNode: AudioWorkletNode | null = null;
private useAudioWorklet: boolean = true;
```

**PROBLEMA POTENCIAL:**
- El AudioWorklet puede fallar silenciosamente en algunos navegadores/Electron
- El fallback puede no activarse correctamente

### 5. 🚨 **Singleton Pattern (NUEVO)**

El patrón Singleton añadido puede causar problemas si:
- El `disconnect()` no limpia correctamente el estado
- Los callbacks se actualizan pero el estado interno no se resetea

## Diagnóstico Probable

### Escenario 1: Desconexión al inicio de carrera
1. App se conecta a Gemini
2. Timer de 9 minutos se inicia
3. Carrera empieza, mucha actividad
4. Algo causa un error (tool call, imagen grande, etc.)
5. La reconexión automática falla o queda en estado inconsistente

### Escenario 2: Desconexión después de compare_laps
1. Usuario pide comparar vueltas
2. Se genera la imagen
3. Se envía `sendToolResponse` exitosamente
4. Entre el response y el envío de imagen, algo falla
5. Gemini queda esperando la imagen
6. Timeout interno de Gemini cierra la conexión
7. La reconexión puede o no funcionar

## Correcciones Propuestas

### Fix 1: Eliminar o hacer opcional el Proactive Reconnect Timer
```typescript
// Opción A: Eliminar completamente
// Opción B: Solo activar si la sesión está idle (sin audio activo)
private startProactiveReconnectTimer(): void {
  // Solo reconectar si no hay actividad reciente
  if (this.isRecording || this.audioQueue.length > 0) {
    console.log("[GeminiLive] ⏸️ Skipping proactive reconnect - session active");
    return;
  }
  // ... resto del código
}
```

### Fix 2: Mejorar manejo de compare_laps
```typescript
} else if (fc.name === "compare_laps") {
  try {
    const result = await lapComparison.compare(lap1Ref, lap2Ref);
    
    if (result.success && result.imageBase64) {
      // SIEMPRE enviar respuesta, incluso si falla después
      this.session.sendToolResponse({
        functionResponses: [{
          id: fc.id,
          name: fc.name,
          response: { result: { success: true, message: 'Processing...' } },
        }],
      });
      
      // Intentar enviar imagen, pero no bloquear si falla
      try {
        if (this.isSessionReady()) {
          this.session.sendClientContent({...});
        }
      } catch (imgErr) {
        console.warn('[CompareLaps] Image send failed, but tool response was sent');
      }
    }
  } catch (error) {
    // SIEMPRE enviar respuesta de error
    this.session.sendToolResponse({
      functionResponses: [{
        id: fc.id,
        name: fc.name,
        response: { result: { success: false, error: error.message } },
      }],
    });
  }
}
```

### Fix 3: Limpiar commandWs en disconnect
```typescript
public disconnect() {
  // ... código existente ...
  
  // Limpiar WebSocket de comandos
  if (this.commandWs) {
    this.commandWs.close();
    this.commandWs = null;
  }
  this.pendingCommandCallbacks.clear();
  
  // Limpiar timer de reconexión proactiva
  this.stopProactiveReconnectTimer();
}
```

### Fix 4: Añadir logging detallado para diagnóstico
```typescript
// En onclose callback
onclose: (closeEvent?: any) => {
  console.error("⚠️ GEMINI CLOSE - Full diagnostic:", {
    code: closeEvent?.code,
    reason: closeEvent?.reason,
    wasClean: closeEvent?.wasClean,
    lastToolCall: this.lastToolCallName,
    lastToolCallTime: this.lastToolCallTime,
    timeSinceLastTurn: Date.now() - this.lastTurnTime.getTime(),
    isRecording: this.isRecording,
    audioQueueLength: this.audioQueue.length,
    pendingCommands: this.pendingCommandCallbacks.size,
  });
}
```

## Próximos Pasos

1. **Inmediato:** Desactivar el proactive reconnect timer temporalmente
2. **Corto plazo:** Mejorar el manejo de errores en compare_laps
3. **Medio plazo:** Añadir logging detallado para capturar el momento exacto de la desconexión
4. **Largo plazo:** Considerar volver a la versión OLD del manejo de herramientas si los problemas persisten

## Archivos a Modificar

- [`client/src/services/gemini-live.ts`](../client/src/services/gemini-live.ts)
  - Líneas 545-595: Proactive reconnect timer
  - Líneas 2203-2324: compare_laps handling
  - Líneas 2459-2689: Command WebSocket handling
