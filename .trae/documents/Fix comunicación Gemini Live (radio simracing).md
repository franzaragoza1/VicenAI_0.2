## Diagnóstico (lo encontrado)
- El frontend envía MUCHO contexto y en dos vías a la vez: `context_update` (throttle 30s/60s) y `context_update_periodic` (10s/30s). Esto mezcla frecuencias y satura.
- Varias inyecciones se envían con `turnComplete: false` (keep-alive, reconexión silenciosa, periodic). Eso deja “turnos abiertos” y provoca que, cuando llega un `turnComplete: true` (p.ej. al soltar PTT), el modelo procese un backlog y responda tarde y fuera de contexto.
- `stopRecording()` fuerza `turnComplete: true` con payload vacío siempre, incluso si no hablaste; eso dispara respuestas “porque sí” (spam en verde / después de meta).
- El prompt se contradice: regla global “si llega [INSTRUCCIÓN] responde” vs wakeup de reconexión que contiene `[INSTRUCCIÓN]: NO respondas… continúa en silencio`. Eso incentiva frases tipo “en silencio esperando orden”.
- El “contexto compacto” no es compacto en carrera: mete tablas de standings por clase repetidas; eso empuja el contexto útil fuera de ventana y empeora el estilo (tiende a redactar).
- El logging y los .txt adjuntos solo registran lo ENVIADO; no puedes auditar audio/texto recibido ni tool calls (en código se filtra explícitamente).

## Cambios propuestos (código)
### 1) Turnos y anti-backlog
- Unificar estrategia de turnos: evitar `turnComplete:false` para mensajes que no deben acumularse (periodic, keep-alive, reconexión) o, alternativamente, enviar esos mensajes por un canal que no abra turno (si la API lo permite en tu wrapper).
- Cambiar `stopRecording()` para enviar `turnComplete:true` solo si hubo audio real en ese turno (flag `hasAudioThisTurn` / contador de frames). Si no hubo voz, no forzar respuesta.

### 2) Reconexión silenciosa sin “INSTRUCCIÓN”
- Reetiquetar el wake-up como `[CONTEXTO_RECONEXION]` (sin `[INSTRUCCIÓN]`) y ajustar el system prompt: “nunca vocalices mensajes de reconexión/keepalive”.

### 3) Contexto realmente “radio”
- Reducir `buildCompactContext()` en Race: eliminar tablas STANDINGS repetitivas; dejar solo: sesión, posición/clase, vuelta, gaps clave, fuel, flags, y 1 línea de objetivo (delante/detrás) sin nombres si no hay dato fiable.
- En Qualy (Lone Qualy): suprimir líneas de “Delante/Detrás” y cualquier tráfico.

### 4) Proactividad correcta (sin spam)
- Mantener proactividad SOLO por eventos discretos (verde, amarilla, posición, incidente, fuel crítico, última vuelta, checkered) con `turnComplete:true`.
- Los `[CONTEXTO]` periódicos quedan como “memoria” y nunca deben disparar respuesta.

### 5) Tools y observabilidad
- Activar logging de `received` + `tool` (quitar el filtro `type !== 'sent'`) y registrar tool calls/latencias.
- (Opcional) Añadir modalidad TEXT además de AUDIO para tener transcript y poder depurar frases raras (sin depender del oído).
- Corregir el log de `turnComplete`: que registre `undefined` vs `false` vs `true` (ahora se escribe `false` aunque el campo no exista).

## Verificación
- Repro en local: sesión Practice → Qualy → Race, y probar:
  - PTT on/off sin hablar (no debe contestar).
  - Inyección `window.testGeminiEvent('green_flag')` (respuesta corta, 1-2 frases).
  - Context updates durante carrera (no backlog, no spam, gaps coherentes).
  - Reconexión proactiva a los 9 min (no debe decir nada de “silencio”).

## Entregables
- PR de cambios en `client/src/services/gemini-live.ts` y ajuste de formato de contexto.
- Logs nuevos que incluyan lo recibido + tool calls para seguir afinando estilo y timing.