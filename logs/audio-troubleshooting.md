# VICEN-AI Audio Troubleshooting Guide

## Problema Reportado
El usuario no puede escuchar las respuestas del ingeniero de carreras IA.

## Diagnóstico Realizado

### 1. Arquitectura de Audio Identificada

El proyecto VICEN-AI tiene dos sistemas de audio principales:

#### A. SpotterAudioService (elevenlabs-tts.ts)
- **Propósito**: Reproduce archivos MP3 pregrabados para alertas críticas del spotter
- **Tecnología**: AudioContext + archivos MP3 locales
- **Estado**: ✅ Implementado correctamente
- **Ubicación**: `/client/src/services/elevenlabs-tts.ts`

#### B. Gemini Live Audio (gemini-live.ts)
- **Propósito**: Síntesis de voz en tiempo real para respuestas del ingeniero IA
- **Tecnología**: Gemini Live API con modalidad AUDIO
- **Estado**: ⚠️ Posibles problemas de configuración
- **Ubicación**: `/client/src/services/gemini-live.ts`

### 2. Configuraciones Encontradas

#### Gemini Live Audio Config:
```typescript
config: {
  responseModalities: [Modality.AUDIO],
  speechConfig: {
    voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zubenelgenubi" } },
  },
  maxOutputTokens: 120,
  temperature: 0.6,
}
```

#### AudioContext Initialization:
```typescript
public async initialize(): Promise<void> {
  if (this.audioContext) return;
  
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  this.audioContext = new AudioContextClass();
  
  if (this.audioContext.state === "suspended") {
    await this.audioContext.resume();
  }
}
```

### 3. Problemas Identificados

#### A. Permisos de Audio en Electron
- **Problema**: Configuración de Electron no incluía permisos específicos para audio
- **Solución Aplicada**: ✅ Agregadas configuraciones de audio en `electron-main.cjs`:
  ```javascript
  webPreferences: {
    webSecurity: false, // Permitir acceso a recursos locales de audio
    allowRunningInsecureContent: true, // Permitir contenido inseguro para audio local
    experimentalFeatures: true // Habilitar características experimentales de audio
  }
  ```

#### B. AudioContext Suspended
- **Problema**: Los navegadores suspenden AudioContext por políticas de autoplay
- **Estado**: ⚠️ Requiere interacción del usuario para activarse
- **Código Existente**: Ya hay lógica para reanudar AudioContext después de reconexiones

#### C. Inicialización de Servicios
- **SpotterAudioService**: Requiere llamada manual a `initialize()`
- **Gemini Live**: Maneja AudioContext internamente

## Soluciones Implementadas

### 1. ✅ Configuración de Electron Mejorada
- Agregados permisos de audio en `webPreferences`
- Habilitadas características experimentales de audio
- Deshabilitada `webSecurity` para recursos locales

### 2. ✅ Manejo de Errores de Audio Mejorado
- Agregado try-catch en la inicialización de SpotterAudioService
- La aplicación continúa funcionando aunque falle el audio del spotter
- Gemini Live audio sigue funcionando independientemente

### 2. 📋 Próximos Pasos Recomendados

#### A. Verificar Inicialización de AudioContext
```typescript
// En el componente principal, asegurar inicialización tras interacción del usuario
const initializeAudio = async () => {
  const spotterService = getSpotterService();
  await spotterService.initialize();
  console.log("SpotterAudioService initialized");
};
```

#### B. Verificar Estado de Gemini Live
```typescript
// Agregar logging para verificar estado de audio
console.log("AudioContext state:", audioContext?.state);
console.log("Gemini Live connected:", isConnected);
```

#### C. Crear Botón de Test de Audio
```typescript
// Botón para probar audio del spotter
const testSpotterAudio = async () => {
  const spotterService = getSpotterService();
  await spotterService.playSpotterPhrase("libre");
};
```

## Comandos de Diagnóstico

### Verificar Estado del Proyecto
```bash
# Iniciar en modo desarrollo con auto-detección
npm run dev:auto

# Solo telemetría para debug
npm run telemetry:auto

# Verificar logs de Electron
# Los logs aparecen en la consola de DevTools (F12)
```

### Verificar Archivos de Audio
```bash
# Verificar que existen archivos MP3 del spotter
dir client\public\audio\spotter\*.mp3

# Verificar manifest de audio
type client\public\audio\spotter\manifest.json
```

## Posibles Causas del Problema

### 1. AudioContext No Inicializado
- **Síntoma**: No se escucha ningún audio
- **Causa**: Falta interacción del usuario para activar AudioContext
- **Solución**: Agregar botón de inicialización de audio

### 2. Gemini Live API Key Faltante
- **Síntoma**: Spotter funciona, pero no respuestas del ingeniero
- **Causa**: Variable `GEMINI_API_KEY` no configurada
- **Solución**: Verificar archivo `.env`

### 3. WebSocket de Audio Desconectado
- **Síntoma**: Conexión establecida pero sin audio
- **Causa**: Problemas de red o configuración de WebSocket
- **Solución**: Verificar logs de conexión

### 4. Permisos del Navegador
- **Síntoma**: Error de permisos en consola
- **Causa**: Navegador bloquea acceso a audio
- **Solución**: Verificar configuración de sitio en navegador

## Estado Actual

- ✅ **Configuración de Electron**: Mejorada con permisos de audio
- ⚠️ **SpotterAudioService**: Implementado, requiere inicialización manual
- ⚠️ **Gemini Live Audio**: Configurado, estado desconocido
- ❓ **Inicialización**: Requiere verificación en runtime

## Próximos Pasos

1. **Probar la aplicación** con las nuevas configuraciones de Electron
2. **Verificar logs** en DevTools para errores de audio
3. **Implementar botón de test** para verificar SpotterAudioService
4. **Verificar configuración** de Gemini API Key
5. **Crear logs de diagnóstico** específicos para audio

---

**Fecha**: 2026-02-07  
**Estado**: Configuración inicial mejorada, requiere testing