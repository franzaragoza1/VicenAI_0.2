# TELEMETRY-LAB2

Sistema de análisis de telemetría para iRacing con **pyirsdk** + Frontend React (copiado de TELEMETRY-LABV1).

## ✅ Arquitectura

- **Backend:** Python con pyirsdk → extrae datos directamente de iRacing
- **Frontend:** React + TypeScript + Vite (mismo UI que V1, sin cambios visuales)
- **Comunicación:** WebSocket en puerto 8887

## 🆕 Características Nuevas

### 1. Auto-guardado de vueltas con clasificación
- ✅ **Todas las vueltas se guardan automáticamente** al completarse
- ✅ Clasificadas por **coche** y **circuito** (extraídos desde iRacing)
- ✅ Máximo 10 vueltas guardadas (las más recientes)
- ✅ Visualización organizada en el selector de vueltas

### 2. Gráficas optimizadas para análisis LLM (Gemini)
- ✅ **Eje X con valores numéricos precisos** (0-100% en incrementos de 5%)
- ✅ **LinearScale** en lugar de CategoryScale para mayor precisión
- ✅ **Gridlines y ticks mejorados** para lectura clara
- ✅ **Coordenadas {x, y}** reales en todos los datasets
- ✅ Labels con metadata completa (coche, tiempo, circuito)
- ✅ Optimizado para interpretación por modelos de IA

### 3. Metadata de circuito y coche
- ✅ Backend extrae `TrackDisplayName` y `CarScreenName` desde iRacing
- ✅ **Layout del circuito incluido** mediante `TrackConfigName`
- ✅ Se transmite en cada punto de telemetría
- ✅ Se guarda en cada vuelta completada
- ✅ Visible en selectores y gráficas

### 4. Steering Angle
- ✅ Extraído desde `SteeringWheelAngle` (radianes)
- ✅ Visualizado en grados (-90° a +90°)
- ✅ Gráfica dedicada con precisión
- ✅ Inputs realistas en vueltas de prueba

## 📦 Instalación

### 1. Backend (Python)
```bash
pip install pyirsdk websockets
```

### 2. Frontend (Node.js)
```bash
cd frontend
npm install
```

## 🚀 Ejecución

### Opción 1: Automática (Recomendado)
```bash
START.bat
```

### Opción 2: Manual

**Terminal 1 - Backend:**
```bash
cd backend
py irsdk_bridge.py
```

**Terminal 2 - Frontend:**
```bash
cd frontend  
npm run dev
```

## 🔌 Endpoints

- **Backend WebSocket:** ws://localhost:8887
- **Frontend Web:** http://localhost:5173

## 📊 Formato de datos

pyirsdk → Backend → WebSocket → Frontend

```json
{
  "distancePct": 0.523,
  "speed": 245.8,
  "throttle": 0.95,
  "brake": 0.0,
  "gear": 5,
  "rpm": 8500,
  "steeringWheelAngle": 0.34,
  "trackName": "Spa-Francorchamps - Grand Prix",
  "carName": "BMW M4 GT3",
  "timestamp": 1706123456789
}
```

## 📈 Gráficas de Telemetría

### Configuración para LLM
Todas las gráficas usan:
- **Eje X:** Distancia en % de vuelta (0-100%, ticks cada 5%)
- **Eje Y:** Valores absolutos con unidades claras
- **Gridlines:** Visibles para referencia precisa
- **Coordenadas reales:** `{x: distancePct * 100, y: valor}`
- **Sin categorías:** LinearScale en ambos ejes

### Gráficas disponibles:
1. **Speed** - Velocidad en km/h (0-300, ticks cada 20)
2. **Throttle** - Acelerador en % (0-100, ticks cada 10)
3. **Brake** - Freno en % (0-100, ticks cada 10)
4. **Gear** - Marcha (0-8, ticks cada 1, línea escalonada)
5. **Steering Angle** - Ángulo del volante en grados (-90 a +90, ticks cada 30)

## 🧪 Vueltas de Prueba

El sistema incluye un generador de vueltas realistas basadas en **Spa-Francorchamps**:
- **Vuelta 1:** Rápida y agresiva (88s) - Frenadas tardías, throttle agresivo
- **Vuelta 2:** Lenta y conservadora (92s) - Frenadas tempranas, throttle suave

Características realistas:
- ✅ Perfil de velocidad preciso (Eau Rouge, Kemmel, Les Combes, Bus Stop)
- ✅ Inputs de throttle y brake coordinados
- ✅ Trail braking en curvas rápidas
- ✅ Steering angle con inputs realistas en cada curva
- ✅ Cambios de marcha automáticos según velocidad
- ✅ RPM realistas con variación natural

**Cómo generar:** Haz clic en "🧪 Generate Test Laps" en modo Mock

## ⚙️ Cambios vs TELEMETRY-LABV1

| Componente | V1 | V2 |
|------------|----|----|
| Backend | SimHub UDP → WebSocket | **pyirsdk → WebSocket** |
| Frontend | React (sin cambios) | React (copiado idéntico) |
| Extracción | SimHub | **iRacing SDK directo** |
| Auto-guardado | Manual | **Automático con metadata** |
| Gráficas | CategoryScale | **LinearScale (LLM-friendly)** |
| Metadata | No | **Coche + Circuito** |

## 📝 Notas

- Reconexión automática a iRacing
- Transmisión a 20Hz
- Frontend idéntico a V1 (aspecto y funcionalidad)
- NO toca TELEMETRY-LABV1
- **Optimizado para análisis con Gemini/LLM**
- Gráficas exportables como PNG para análisis de IA
