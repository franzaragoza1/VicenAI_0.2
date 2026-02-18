# Troubleshooting Eleven Labs TTS

## Test rápido de conexión

```bash
cd server
node test-elevenlabs.js
```

Este script probará la conexión directamente y mostrará logs detallados.

## Problemas comunes

### 1. "Failed to connect" o timeout

**Causa:** API key inválida o incorrecta

**Solución:**
1. Verifica tu API key en https://elevenlabs.io/app/settings/api-keys
2. Asegúrate de copiar la key completa (empieza con algo como `sk_...`)
3. En `.env`, verifica que esté sin comillas:
   ```bash
   ELEVENLABS_API_KEY=sk_1234567890abcdef...
   ```

### 2. "Voice ID not found"

**Causa:** El Voice ID no existe o no tienes acceso

**Solución:**
1. Ve a https://elevenlabs.io/voice-library
2. Encuentra una voz que te guste
3. Copia el Voice ID (debajo del nombre de la voz)
4. Actualiza en `.env`:
   ```bash
   ELEVENLABS_VOICE_ID=tu_voice_id_aqui
   ```

**Voces predefinidas que deberían funcionar:**
- `pNInz6obpgDQGcFmaJgB` - Adam (male, clear)
- `EXAVITQu4vr4xnSDxMaL` - Bella (female, friendly)
- `21m00Tcm4TlvDq8ikWAM` - Rachel (female, calm)

### 3. No se oye audio

**Causa:** Formato de audio incompatible

**Verificación:**
En `.env`, usa estos valores probados:
```bash
# Estos formatos funcionan con el cliente actual:
ELEVENLABS_MODEL_ID=eleven_turbo_v2_5
```

El output format `pcm_16000` es compatible con el sistema actual.

### 4. "Quota exceeded"

**Causa:** Has superado tu límite de caracteres del mes

**Solución:**
1. Revisa tu uso en https://elevenlabs.io/app/usage
2. Espera al próximo ciclo o actualiza tu plan
3. Mientras tanto, usa Cartesia:
   ```bash
   TTS_PROVIDER=cartesia
   ```

### 5. Latencia muy alta

**Causa:** Modelo incorrecto o configuración subóptima

**Solución:**
Usa el modelo más rápido:
```bash
ELEVENLABS_MODEL_ID=eleven_turbo_v2_5
```

**NO uses:**
- `eleven_multilingual_v2` (más lento pero mejor calidad)
- `eleven_monolingual_v1` (solo inglés, más lento)

### 6. WebSocket se desconecta constantemente

**Causa:** Problemas de red o API key inválida

**Debug:**
1. Ejecuta el test script:
   ```bash
   node server/test-elevenlabs.js
   ```

2. Revisa los logs del servidor buscando:
   ```
   [ElevenLabs] WebSocket error:
   ```

3. Verifica que no hay firewall bloqueando `wss://api.elevenlabs.io`

## Verificar configuración actual

Revisa tu `.env`:

```bash
# Debe estar así:
TTS_PROVIDER=elevenlabs
ELEVENLABS_API_KEY=sk_...  # Tu key completa
ELEVENLABS_MODEL_ID=eleven_turbo_v2_5
ELEVENLABS_VOICE_ID=pNInz6obpgDQGcFmaJgB  # O tu voice ID
```

## Logs útiles para debugging

Cuando inicies el servidor, deberías ver:

```
[TTSFactory] Creating TTS provider: elevenlabs
[ElevenLabs] Initialized with model: eleven_turbo_v2_5, voice: pNInz6obpgDQGcFmaJgB
[ElevenLabs] Connecting to Eleven Labs...
[ElevenLabs] URL: wss://api.elevenlabs.io/v1/text-to-speech/pNInz6obpgDQGcFmaJgB/stream-input?model_id=eleven_turbo_v2_5&output_format=pcm_16000
[ElevenLabs] WebSocket opened
[ElevenLabs] Sending initial config: {...}
[ElevenLabs] Connected successfully
```

Si ves errores, copia el mensaje completo y busca en este documento.

## Todavía no funciona?

1. **Prueba con Cartesia primero:**
   ```bash
   TTS_PROVIDER=cartesia
   CARTESIA_API_KEY=tu_cartesia_key
   ```

2. **Verifica que Cartesia funciona:** Si Cartesia funciona pero Eleven Labs no, el problema es específico de Eleven Labs (probablemente API key o quota).

3. **Contacta soporte de Eleven Labs:**
   - Email: support@elevenlabs.io
   - Discord: https://discord.gg/elevenlabs

4. **Abre un issue en GitHub:**
   - Incluye los logs del servidor
   - Incluye tu configuración (SIN la API key)
   - Menciona qué modelo/voz estás usando
