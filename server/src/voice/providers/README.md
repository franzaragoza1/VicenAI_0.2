# TTS Providers

VICEN AI soporta múltiples proveedores de TTS (Text-to-Speech) de forma intercambiable.

## Proveedores disponibles

### 🚀 Cartesia (Default)
**Recomendado para:** Baja latencia, tiempo real, streaming

- **Website:** https://cartesia.ai/
- **Pricing:** Pay-per-character, free tier disponible
- **Características:**
  - ✅ Latencia ultra-baja (< 100ms)
  - ✅ Control de emoción nativo (`neutral`, `calm`, `excited`, `scared`, `angry`, `sad`)
  - ✅ Control de velocidad (0.7x - 1.5x)
  - ✅ Streaming WebSocket
  - ✅ Multilingual (español excelente)

**Configuración:**
```bash
TTS_PROVIDER=cartesia
CARTESIA_API_KEY=your_api_key
CARTESIA_MODEL_ID=sonic-3-turbo  # Fastest model
CARTESIA_VOICE_ID=a0e99841-438c-4a64-b679-ae501e7d6091  # Spanish male
```

**Voces recomendadas para español:**
- `a0e99841-438c-4a64-b679-ae501e7d6091` - Hombre español (natural, claro)
- Explora más voces en: https://cartesia.ai/voices

---

### 🎙️ Eleven Labs
**Recomendado para:** Máxima calidad de voz, voice cloning

- **Website:** https://elevenlabs.io/
- **Pricing:** Subscripción + pay-per-character
- **Características:**
  - ✅ Calidad de voz superior
  - ✅ Voice cloning (crea tu propia voz)
  - ✅ Multilingual (30+ idiomas)
  - ✅ Streaming WebSocket
  - ⚠️ Latencia mayor que Cartesia (~150-300ms)
  - ⚠️ Sin control de emoción directo (usa voice selection)

**Configuración:**
```bash
TTS_PROVIDER=elevenlabs
ELEVENLABS_API_KEY=your_api_key
ELEVENLABS_MODEL_ID=eleven_turbo_v2_5  # Recommended for real-time
ELEVENLABS_VOICE_ID=pNInz6obpgDQGcFmaJgB  # Adam (male, clear)
```

**Modelos disponibles:**
| Model ID | Latencia | Calidad | Idiomas | Recomendado para |
|----------|----------|---------|---------|------------------|
| `eleven_turbo_v2_5` | ⚡ ~100ms | 🟢 Buena | 32 idiomas | **Racing/tiempo real** |
| `eleven_turbo_v2` | ⚡ ~150ms | 🟢 Buena | 29 idiomas | Tiempo real |
| `eleven_multilingual_v2` | 🟡 ~300ms | ⭐ Excelente | 29 idiomas | Calidad máxima |
| `eleven_monolingual_v1` | 🟡 ~250ms | ⭐ Superior | Solo inglés | Calidad inglés |

**Para racing, usa:** `eleven_turbo_v2_5` (el más rápido)

**Voces recomendadas:**
- `pNInz6obpgDQGcFmaJgB` - Adam (inglés claro)
- `EXAVITQu4vr4xnSDxMaL` - Bella (femenina, amigable)
- O crea tu propia voz personalizada: https://elevenlabs.io/voice-lab

**Limitaciones:**
- Emotion/Speed: Eleven Labs no soporta estos parámetros directamente
  - `emotion`: Se ignora (selecciona voz apropiada en su lugar)
  - `speed`: Se aproxima ajustando `stability` (experimental)

---

## Cambiar de proveedor

### Opción 1: Variable de entorno (recomendado)
Edita tu archivo `.env`:
```bash
TTS_PROVIDER=elevenlabs  # Cambia a "cartesia" o "elevenlabs"
```

### Opción 2: Por código
Edita `server/src/voice/providers/tts-factory.ts` para añadir lógica personalizada.

---

## Añadir nuevos proveedores

Para integrar un nuevo proveedor TTS:

1. **Crea el servicio** implementando la interfaz `TTSProvider`:
   ```typescript
   // server/src/voice/providers/myprovider-tts.ts
   import { TTSProvider, SynthesisOptions } from './tts-provider.js';

   export class MyProviderTTSService extends EventEmitter implements TTSProvider {
     async connect(): Promise<void> { /* ... */ }
     disconnect(): void { /* ... */ }
     synthesize(options: SynthesisOptions): void { /* ... */ }
     cancel(): void { /* ... */ }
     isConnected(): boolean { /* ... */ }
     getIsStreaming(): boolean { /* ... */ }

     // Emit events: 'connected', 'audioChunk', 'chunkDone', 'completed', 'error'
   }
   ```

2. **Registra en factory** (`tts-factory.ts`):
   ```typescript
   case 'myprovider':
     return createMyProviderProvider();
   ```

3. **Configura `.env`**:
   ```bash
   TTS_PROVIDER=myprovider
   MYPROVIDER_API_KEY=your_key
   ```

---

## Testing

Para probar tu proveedor TTS:

1. Configura las credenciales en `.env`
2. Inicia el servidor: `npm run dev`
3. Conecta el cliente de voz
4. El sistema usará automáticamente el proveedor configurado

**Debugging:**
```bash
# Habilita logs de audio chunks
VOICE_DEBUG_SAVE_TTS_CHUNKS=1
```
Los chunks se guardan en `server/audio_debug/` como archivos WAV.

---

## Comparativa

| Feature | Cartesia | Eleven Labs |
|---------|----------|-------------|
| **Latencia** | ⚡ < 100ms | 🟡 150-300ms |
| **Calidad** | 🟢 Excelente | ⭐ Superior |
| **Español** | ✅ Nativo | ✅ Multilingual |
| **Emotion control** | ✅ 7 emociones | ❌ Via voice |
| **Speed control** | ✅ 0.7x - 1.5x | 🟡 Limitado |
| **Voice cloning** | ❌ No | ✅ Sí |
| **Precio** | 💰 Pay-per-char | 💰💰 Subscription |
| **Free tier** | ✅ Generoso | ⚠️ Limitado |

**Recomendación:**
- **Racing en tiempo real:** Cartesia (latencia crítica)
- **Streaming/contenido:** Eleven Labs (máxima calidad)
