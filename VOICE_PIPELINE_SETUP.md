# 🎙️ Voice Pipeline Setup Guide

Guía completa para configurar el nuevo pipeline de voz **STT → LLM → TTS** (Deepgram + Qwen3 + Cartesia).

---

## 📋 Requisitos

### API Keys Necesarias

Necesitas crear cuentas y obtener API keys de 3 servicios:

#### 1. **Deepgram** (Speech-to-Text)
- **URL**: https://console.deepgram.com/signup
- **Plan**: Free tier incluye $200 créditos (suficiente para testing)
- **Coste**: $0.0043/minuto = ~$0.26/hora
- **Cómo obtener la key**:
  1. Crear cuenta en Deepgram
  2. Ir a "API Keys" en el dashboard
  3. Crear nueva key (copiar y guardar)

#### 2. **OpenRouter** (LLM Gateway)
- **URL**: https://openrouter.ai/auth/signup
- **Plan**: Pay-as-you-go (añadir $5-10 iniciales)
- **Coste**: ~$0.004/hora con Qwen3-235B
- **Cómo obtener la key**:
  1. Crear cuenta en OpenRouter
  2. Añadir créditos: https://openrouter.ai/credits
  3. Ir a "Keys" → Crear nueva key
  4. Copiar y guardar la key

#### 3. **Cartesia** (Text-to-Speech)
- **URL**: https://cartesia.ai/signup
- **Plan**: Free tier incluye créditos iniciales
- **Coste**: $0.03/minuto = ~$1.80/hora
- **Cómo obtener la key**:
  1. Crear cuenta en Cartesia
  2. Ir a "API Keys" en dashboard
  3. Crear nueva key (copiar y guardar)

---

## ⚙️ Configuración

### 1. Server Configuration

Crea el archivo `server/.env` (o edita el existente):

```bash
# Voice Pipeline API Keys
DEEPGRAM_API_KEY=tu_deepgram_key_aqui
DEEPGRAM_MODEL=nova-2

OPENROUTER_API_KEY=tu_openrouter_key_aqui
OPENROUTER_MODEL=qwen/qwen3-235b-a22b-2507:nitro
OPENROUTER_FALLBACK_MODEL=openai/gpt-4o-mini

CARTESIA_API_KEY=tu_cartesia_key_aqui
CARTESIA_MODEL_ID=sonic-3-turbo
CARTESIA_VOICE_ID=a0e99841-438c-4a64-b679-ae501e7d6091

# Logging (opcional)
VOICE_LOG_LEVEL=info
```

**Importante**: Las API keys NUNCA deben ir en el cliente, solo en el servidor.

### 2. Client Configuration

Crea el archivo `client/.env` (o edita el existente):

```bash
# Voice Engine Selection
VITE_VOICE_ENGINE=pipeline
```

**Opciones**:
- `pipeline`: Nuevo pipeline modular (Deepgram + Qwen3 + Cartesia)
- `gemini`: Gemini Live original (fallback)

---

## 🚀 Uso

### Arrancar el Servidor

```bash
npm start
```

El servidor arrancará en `http://localhost:8081` con el endpoint WebSocket `/voice`.

### Logs Esperados

Si todo está configurado correctamente, verás:

```
[Server] Listening on http://localhost:8081
[Voice] Session created: voice-1
[DeepgramSTT] Connected successfully
[CartesiaTTS] Connected successfully
[Voice] STT connected for session voice-1
[Voice] TTS connected for session voice-1
```

### Errores Comunes

**Error**: `DEEPGRAM_API_KEY not set in environment`
- **Solución**: Verifica que `.env` existe en `server/` y contiene la key

**Error**: `OpenRouter API error: 401`
- **Solución**: API key incorrecta o sin créditos. Verifica en https://openrouter.ai/credits

**Error**: `Cartesia WebSocket closed: 1002`
- **Solución**: API key incorrecta. Verifica en https://cartesia.ai/console

---

## 🎮 Controles

### PTT (Push-to-Talk)
- **F14**: Toggle mic ON/OFF
- El pipeline usa **open-mic + endpointing** (300ms silencio finaliza turno)
- PTT OFF no corta la voz del asistente (solo VAD puede interrumpir)

### Barge-in (Interrumpir al Asistente)
- Habla mientras el asistente está hablando
- VAD detecta tu voz → interrumpe TTS con fade-out < 150ms
- Empieza nueva captura automáticamente

---

## 💰 Costes Estimados

Para una **sesión de 1 hora** de carrera con ~20 interacciones:

| Servicio | Uso Estimado | Coste |
|----------|--------------|-------|
| **Deepgram STT** | 10 min piloto hablando | $0.043 |
| **Qwen3 LLM** | 20 queries (~450 tokens/query) | $0.004 |
| **Cartesia TTS** | 8 min respuestas TTS | $0.24 |
| **TOTAL** | | **$0.287/hora** |

**Comparación**: Gemini Live costaba ~$6-10/hora estimado (95-97% ahorro).

---

## 🐛 Debugging

### Habilitar Logs Verbose

En `server/.env`:
```bash
VOICE_LOG_LEVEL=debug
```

### Ver Estado del Pipeline

Los logs mostrarán:
```
[Voice] Mic state changed: true
[DeepgramSTT] Partial transcript: "¿Cuál es mi gap?"
[DeepgramSTT] Final transcript: "¿Cuál es mi gap con el de delante?"
[Voice] STT final → triggering LLM
[OpenRouterLLM] Sending message to qwen/qwen3-235b-a22b-2507:nitro
[OpenRouterLLM] Stream completed in 850ms
[CartesiaTTS] Synthesizing: "Tienes 2.3 segundos con el rival de delante."
```

### Verificar Conexiones

En los logs del server al inicio:
- `[DeepgramSTT] Connected successfully` ✅
- `[CartesiaTTS] Connected successfully` ✅
- `[Voice] STT connected for session voice-1` ✅

Si alguna falta, revisa las API keys.

---

## 🔄 Rollback a Gemini Live

Si necesitas volver al sistema anterior:

1. Cambiar `client/.env`:
   ```bash
   VITE_VOICE_ENGINE=gemini
   ```

2. Reiniciar la app

**Tiempo de rollback**: < 5 minutos

---

## 📊 Métricas de Calidad

### Latencia Objetivo
- **PTT ON → primer partial STT**: < 500ms
- **Fin de frase → inicio audio TTS**: < 1.5s promedio
- **Barge-in fade-out**: < 150ms

### Calidad de Output
- ✅ 100% español de España
- ✅ Sin preámbulos ("voy a...", "let me...")
- ✅ Estilo radio F1 (1-3 frases)
- ✅ Sin markdown/listas/títulos

---

## ❓ FAQ

**P: ¿Necesito las 3 API keys para que funcione?**
R: Sí, el pipeline necesita STT + LLM + TTS. Sin alguna, la sesión de voz no se iniciará.

**P: ¿Puedo usar otros modelos LLM?**
R: Sí, cambia `OPENROUTER_MODEL` en `.env`. Opciones recomendadas:
- `qwen/qwen3-235b-a22b-2507:nitro` (actual, muy rápido)
- `openai/gpt-4o-mini` (más caro pero muy fiable)
- `meta-llama/llama-4-maverick:nitro` (experimental)

**P: ¿Puedo cambiar la voz del TTS?**
R: Sí, explora voces en https://cartesia.ai/voices y cambia `CARTESIA_VOICE_ID` en `.env`.

**P: ¿El pipeline funciona offline?**
R: No, requiere conexión a internet para STT/LLM/TTS. Gemini Live tampoco funciona offline.

**P: ¿Qué pasa si me quedo sin créditos?**
R: El servicio específico fallará pero la app seguirá funcionando (telemetría, overlay, etc.). Verás errores en logs.

---

## 🛠️ Troubleshooting Avanzado

### Error: "Failed to connect to Deepgram"
- Verificar conectividad a `wss://api.deepgram.com`
- Firewall/antivirus puede bloquear WebSocket
- Probar con otra red

### Error: "OpenRouter stream timeout"
- Red lenta o modelo no disponible
- El fallback a `gpt-4o-mini` debería activarse automáticamente
- Verificar en https://openrouter.ai/models si Qwen3 está activo

### Audio distorsionado o cortado
- Verificar sample rate del mic (debe ser 48kHz o 44.1kHz)
- AudioWorklet puede fallar en algunos navegadores → fallback a ScriptProcessor
- Ver logs: `[MicCapture] Using AudioWorklet` o `Using ScriptProcessor`

---

## 📞 Soporte

- **Deepgram Docs**: https://developers.deepgram.com/
- **OpenRouter Docs**: https://openrouter.ai/docs
- **Cartesia Docs**: https://docs.cartesia.ai/
- **VICEN Issues**: https://github.com/tu-repo/issues
