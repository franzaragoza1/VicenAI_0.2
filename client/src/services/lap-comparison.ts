/**
 * Lap Comparison Service
 * 
 * High-level service for generating lap comparison snapshots.
 * Used by the Gemini tool and the LapManager UI.
 */

import { lapApi, LapData } from './lap-api';
import { generateComparisonImage, downloadComparisonImage } from '../utils/chart-renderer';

export interface ComparisonResult {
  success: boolean;
  imageBase64?: string;
  lap1?: LapData;
  lap2?: LapData;
  error?: string;
  metadata?: {
    trackName: string;
    lap1Time: number;
    lap2Time: number;
    delta: number;
    lap1Number: number;
    lap2Number: number;
  };
}

class LapComparisonService {
  /**
   * Generate a comparison between two laps by reference
   * 
   * References can be:
   * - 'session_best' or 'best' - The session best lap
   * - 'last' - The most recently completed lap
   * - A lap number (e.g., '15' or 15)
   * - A lap ID
   */
  async compare(
    lap1Ref: string | number,
    lap2Ref: string | number
  ): Promise<ComparisonResult> {
    try {
      // Normalize references
      const normalizedLap1Ref = this.normalizeReference(lap1Ref);
      const normalizedLap2Ref = this.normalizeReference(lap2Ref);

      // Fetch both laps
      const [lap1, lap2] = await Promise.all([
        this.fetchLap(normalizedLap1Ref),
        this.fetchLap(normalizedLap2Ref),
      ]);

      if (!lap1 && !lap2) {
        return {
          success: false,
          error: 'No hay vueltas guardadas. Completa al menos una vuelta primero.',
        };
      }

      // If only one lap exists, still allow comparison (will show single lap analysis)
      if (!lap1 || !lap2) {
        const availableLap = lap1 || lap2;
        console.log(`[LapComparison] Only one lap available (Lap ${availableLap?.lapNumber}), generating single lap view`);
      }

      // Generate comparison image (handles null laps gracefully)
      const imageBase64 = await generateComparisonImage(lap1, lap2);

      // Calculate metadata
      const metadata = this.calculateMetadata(lap1, lap2);

      return {
        success: true,
        imageBase64,
        lap1: lap1 || undefined,
        lap2: lap2 || undefined,
        metadata,
      };
    } catch (error) {
      console.error('[LapComparison] Error:', error);
      return {
        success: false,
        error: `Error al comparar vueltas: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Compare and download the image directly
   */
  async compareAndDownload(
    lap1Ref: string,
    lap2Ref: string,
    filename?: string
  ): Promise<ComparisonResult> {
    const result = await this.compare(lap1Ref, lap2Ref);

    if (result.success && result.lap1 && result.lap2) {
      await downloadComparisonImage(result.lap1, result.lap2, filename);
    }

    return result;
  }

  /**
   * Get a formatted analysis prompt for Gemini
   */
  getAnalysisPrompt(result: ComparisonResult): string {
    if (!result.success || !result.metadata) {
      return 'No hay datos de comparación disponibles.';
    }

    const { trackName, lap1Time, lap2Time, delta, lap1Number, lap2Number } = result.metadata;
    const deltaSign = delta >= 0 ? '+' : '';
    const fasterLap = delta <= 0 ? lap1Number : lap2Number;

    // Only one lap available case
    if (lap1Time === 0 || lap2Time === 0) {
      const availableLap = lap1Time > 0 ? lap1Number : lap2Number;
      const availableTime = lap1Time > 0 ? lap1Time : lap2Time;
      return `[ANÁLISIS DE TELEMETRÍA - VUELTA INDIVIDUAL]

📍 Circuito: ${trackName}
🔵 Vuelta ${availableLap}: ${this.formatLapTime(availableTime)}

Solo hay una vuelta disponible para analizar. La imagen muestra la telemetría de esta vuelta.

[INSTRUCCIÓN]: Analiza la vuelta y busca áreas de mejora potencial:
1. Zonas con frenadas bruscas o tardías
2. Aplicación del acelerador (¿suave o agresiva?)
3. Consistencia en las curvas

⚠️ IMPORTANTE: No digas "en el X% de la vuelta". Traduce siempre a "Curva X" o nombre de la curva.
Responde como ingeniero de carrera. Máximo 3-4 frases útiles.`;
    }

    return `[ANÁLISIS DE TELEMETRÍA - COMPARACIÓN DE VUELTAS]

📍 Circuito: ${trackName}

🔵 Vuelta ${lap1Number} (Azul, línea sólida): ${this.formatLapTime(lap1Time)}
🔴 Vuelta ${lap2Number} (Rojo, línea discontinua): ${this.formatLapTime(lap2Time)}

⏱️ Diferencia: ${deltaSign}${delta.toFixed(3)}s (La vuelta ${fasterLap} es más rápida)

La imagen muestra 5 gráficos superpuestos:
1. **Speed (km/h)**: Velocidad en cada punto del circuito
2. **Throttle (%)**: Posición del acelerador (0-100%)
3. **Brake (%)**: Presión del freno (0-100%)
4. **Gear**: Marcha seleccionada
5. **Steering (deg)**: Ángulo del volante en grados

El eje X representa el % de la vuelta completado (0-100%).

[INSTRUCCIÓN]: Analiza las diferencias entre las dos vueltas. Identifica:
1. ¿Dónde se gana/pierde tiempo? (menciona la curva, NO el porcentaje)
2. Diferencias en puntos de frenada
3. Diferencias en aplicación de throttle
4. Diferencias en trazadas (steering)
5. Recomendaciones específicas para mejorar

⚠️ IMPORTANTE: No digas "en el X% de la vuelta". Traduce siempre a "Curva X", "la horquilla", "el chicane", "la recta principal", etc.
Responde como ingeniero de carrera, sé específico y conciso. Máximo 4-5 frases clave.`;
  }

  /**
   * Normalize a lap reference string
   */
  private normalizeReference(ref: string | number): string {
    // Handle numbers directly (lap numbers from Gemini)
    if (typeof ref === 'number') {
      return String(ref);
    }
    
    const lower = String(ref).toLowerCase().trim();
    
    // Handle common aliases
    if (lower === 'best' || lower === 'session_best' || lower === 'session-best' || lower === 'mejor') {
      return 'session_best';
    }
    
    if (lower === 'last' || lower === 'última' || lower === 'ultima') {
      return 'last';
    }
    
    return String(ref);
  }

  /**
   * Fetch a lap by reference
   */
  private async fetchLap(ref: string): Promise<LapData | null> {
    try {
      return await lapApi.getLapByReference(ref);
    } catch (error) {
      console.warn(`[LapComparison] Could not fetch lap "${ref}":`, error);
      return null;
    }
  }

  /**
   * Calculate comparison metadata
   */
  private calculateMetadata(
    lap1: LapData | null,
    lap2: LapData | null
  ): ComparisonResult['metadata'] | undefined {
    if (!lap1 && !lap2) {
      return undefined;
    }

    const trackName = lap1?.trackName || lap2?.trackName || 'Unknown Track';
    const lap1Time = lap1?.lapTime || 0;
    const lap2Time = lap2?.lapTime || 0;
    const delta = lap1Time && lap2Time ? lap2Time - lap1Time : 0;

    return {
      trackName,
      lap1Time,
      lap2Time,
      delta,
      lap1Number: lap1?.lapNumber || 0,
      lap2Number: lap2?.lapNumber || 0,
    };
  }

  /**
   * Format lap time as M:SS.mmm
   */
  private formatLapTime(seconds: number): string {
    if (seconds <= 0) return '--:--.---';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toFixed(3).padStart(6, '0')}`;
  }
}

// Singleton instance
export const lapComparison = new LapComparisonService();
