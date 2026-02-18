## Lo que hay ahora (confirmado)
- El bloque que ves “con formato” es un `template string` válido asignado a `systemInstruction` dentro de `connect()`; no parece texto pegado accidentalmente fuera de comillas. Empieza en [gemini-live.ts:L1872](file:///c:/Users/zarag/Documents/VICEN-AI-0.1/client/src/services/gemini-live.ts#L1872) y cierra correctamente en [gemini-live.ts:L2112](file:///c:/Users/zarag/Documents/VICEN-AI-0.1/client/src/services/gemini-live.ts#L2111-L2116).
- No encuentro restos tipo `\<system-reminder\>` incrustados.
- Hay 5 `�` en comentarios (emoji/encoding), p. ej. [gemini-live.ts:L2238](file:///c:/Users/zarag/Documents/VICEN-AI-0.1/client/src/services/gemini-live.ts#L2238).

## Objetivo (según tu instrucción)
- Mudar el system prompt a otro archivo.
- No recortar contenido: solo “limpiar la forma” (quitar markdown/ruido sin perder reglas).
- Atacar los cortes por turnComplete/interrupciones (sin asumir que sea por tokens).

## Plan de cambios
### 1) Extraer el prompt a un archivo nuevo (sin cambios funcionales)
- Crear `client/src/services/gemini-system-instruction.ts` con una función `buildSystemInstruction({ simulator, initialContext })`.
- La función devolverá el texto completo del prompt, y `gemini-live.ts` solo hará:
  - `const systemInstruction = buildSystemInstruction({...})`
  - Mantener la misma interpolación de simulador y el `CONTEXTO INICIAL`.

### 2) Limpiar la forma del prompt sin recortar contenido
- Transformación mecánica, manteniendo todas las frases/reglas/ejemplos:
  - `## ...` / `### ...` → títulos en texto plano (por ejemplo `PERSONALIDAD:`).
  - Listas con `-` → líneas en texto plano prefijadas por `•` o `-` pero sin estructura Markdown de headings.
  - Emojis de secciones (🟢🟡🟠🔴 etc.) → opcional: o se eliminan o se reemplazan por tags `[MODO VERDE]` para evitar caracteres raros.
  - Corregir el caso `##CONTEXTO...` → `CONTEXTO...` (solo forma).
- Resultado: mismo contenido semántico, pero sin “documento markdown” incrustado.

### 3) Arreglar caracteres raros de encoding
- Reemplazar `�` en comentarios por texto ASCII (o por el emoji correcto) para evitar que VSCode/TS Server se rompa en algunos setups.

### 4) Estabilizar cortes por turn boundaries (diagnóstico + mitigación)
- Hipótesis más probable (por el patrón del archivo): se envían mensajes de contexto/keepalive mientras el modelo está generando o justo antes de cerrar el turno, provocando interrupciones o turn starvation.
- Implementación propuesta:
  - Añadir un “gate” de envío: si `isWaitingForResponse` o si el sistema está reproduciendo audio del modelo, no enviar `[CONTEXTO]` periódicos/heartbeat; en su lugar, encolar el último contexto y mandarlo tras `serverContent.turnComplete`.
  - Registrar (solo con logs existentes) eventos clave: `audioStreamEnd` enviado, primer chunk recibido, `turnComplete` recibido, y cualquier envío de contexto durante ese intervalo.
  - Asegurar que reconexión silenciosa/heartbeat nunca dispare un turno nuevo durante una respuesta.

### 5) Verificación
- Revisar diagnósticos de VSCode/TypeScript tras extraer el prompt (esperable: desaparezcan la mayoría si eran por parsing/tamaño).
- Validación manual del flujo: PTT → `audioStreamEnd` → respuesta completa sin cortes → `turnComplete`.

## Entregables
- Prompt movido a archivo nuevo y “limpio de forma” sin perder reglas.
- Eliminación de caracteres `�`.
- Gate de envío para evitar que contexto/keepalive corte turnos.
- Comprobación final con diagnósticos/build.