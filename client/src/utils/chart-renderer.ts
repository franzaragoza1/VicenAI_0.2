/**
 * Chart Renderer
 * 
 * Utility to render telemetry comparison charts to an offscreen canvas
 * for export as PNG image (to send to Gemini for analysis).
 */

import { LapData, TelemetryPoint } from '../services/lap-api';

// Chart colors
const COLORS = {
  lap1: {
    line: '#3B82F6',      // Blue
    fill: 'rgba(59, 130, 246, 0.1)',
  },
  lap2: {
    line: '#EF4444',      // Red
    fill: 'rgba(239, 68, 68, 0.1)',
  },
  grid: 'rgba(255, 255, 255, 0.1)',
  text: '#FFFFFF',
  textSecondary: '#9CA3AF',
  background: '#1F2937',  // Dark gray
};

interface ChartConfig {
  title: string;
  yLabel: string;
  yMin: number;
  yMax: number;
  yStep: number;
  getValue: (point: TelemetryPoint) => number;
  formatY?: (value: number) => string;
}

const CHART_CONFIGS: ChartConfig[] = [
  {
    title: 'Speed',
    yLabel: 'km/h',
    yMin: 0,
    yMax: 350,
    yStep: 50,
    getValue: (p) => p.speed,
  },
  {
    title: 'Throttle',
    yLabel: '%',
    yMin: 0,
    yMax: 100,
    yStep: 20,
    getValue: (p) => p.throttle * 100,
    formatY: (v) => `${v}%`,
  },
  {
    title: 'Brake',
    yLabel: '%',
    yMin: 0,
    yMax: 100,
    yStep: 20,
    getValue: (p) => p.brake * 100,
    formatY: (v) => `${v}%`,
  },
  {
    title: 'Gear',
    yLabel: 'Gear',
    yMin: 0,
    yMax: 8,
    yStep: 1,
    getValue: (p) => p.gear,
  },
  {
    title: 'Steering',
    yLabel: 'deg',
    yMin: -90,
    yMax: 90,
    yStep: 30,
    getValue: (p) => (p.steeringAngle * 180) / Math.PI, // rad to deg
    formatY: (v) => `${v}°`,
  },
];

/**
 * Format lap time as M:SS.mmm
 */
function formatLapTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toFixed(3).padStart(6, '0')}`;
}

/**
 * Render a comparison chart to canvas
 */
function renderChart(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  config: ChartConfig,
  lap1: LapData | null,
  lap2: LapData | null
): void {
  const padding = { top: 30, right: 20, bottom: 30, left: 60 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  
  const chartX = x + padding.left;
  const chartY = y + padding.top;

  // Title
  ctx.fillStyle = COLORS.text;
  ctx.font = 'bold 14px Inter, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(config.title, x + 10, y + 20);

  // Draw grid
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 0.5;

  // Y axis grid lines
  const yRange = config.yMax - config.yMin;
  for (let yVal = config.yMin; yVal <= config.yMax; yVal += config.yStep) {
    const yPos = chartY + chartHeight - ((yVal - config.yMin) / yRange) * chartHeight;
    
    ctx.beginPath();
    ctx.moveTo(chartX, yPos);
    ctx.lineTo(chartX + chartWidth, yPos);
    ctx.stroke();

    // Y labels
    ctx.fillStyle = COLORS.textSecondary;
    ctx.font = '10px Inter, system-ui, sans-serif';
    ctx.textAlign = 'right';
    const label = config.formatY ? config.formatY(yVal) : yVal.toString();
    ctx.fillText(label, chartX - 5, yPos + 3);
  }

  // X axis grid lines (every 10%)
  for (let xPct = 0; xPct <= 100; xPct += 10) {
    const xPos = chartX + (xPct / 100) * chartWidth;
    
    ctx.beginPath();
    ctx.moveTo(xPos, chartY);
    ctx.lineTo(xPos, chartY + chartHeight);
    ctx.stroke();

    // X labels
    if (xPct % 20 === 0) {
      ctx.fillStyle = COLORS.textSecondary;
      ctx.font = '10px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${xPct}%`, xPos, chartY + chartHeight + 15);
    }
  }

  // Draw data lines
  const drawLine = (lap: LapData, color: string, dashed: boolean = false) => {
    if (!lap.points || lap.points.length === 0) return;

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    if (dashed) {
      ctx.setLineDash([5, 5]);
    } else {
      ctx.setLineDash([]);
    }

    ctx.beginPath();
    let first = true;

    for (const point of lap.points) {
      const xPos = chartX + point.distancePct * chartWidth;
      const value = config.getValue(point);
      const yPos = chartY + chartHeight - ((value - config.yMin) / yRange) * chartHeight;

      // Clamp to chart area
      const clampedY = Math.max(chartY, Math.min(chartY + chartHeight, yPos));

      if (first) {
        ctx.moveTo(xPos, clampedY);
        first = false;
      } else {
        ctx.lineTo(xPos, clampedY);
      }
    }

    ctx.stroke();
    ctx.setLineDash([]);
  };

  // Draw lap 1 (solid blue)
  if (lap1) {
    drawLine(lap1, COLORS.lap1.line, false);
  }

  // Draw lap 2 (dashed red)
  if (lap2) {
    drawLine(lap2, COLORS.lap2.line, true);
  }

  // Y axis label
  ctx.save();
  ctx.translate(x + 15, y + height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = COLORS.textSecondary;
  ctx.font = '11px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(config.yLabel, 0, 0);
  ctx.restore();
}

/**
 * Generate a comparison image for two laps
 */
export async function generateComparisonImage(
  lap1: LapData | null,
  lap2: LapData | null,
  options: {
    width?: number;
    height?: number;
  } = {}
): Promise<string> {
  // OPTIMIZACIÓN: Resolución reducida para evitar bloqueos del hilo principal
  // 1920x1200 causaba freezes con toDataURL síncrono, especialmente con OBS activo
  const width = options.width || 1024;
  const height = options.height || 768;

  // Create canvas
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Failed to create canvas context');
  }

  // Background
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, width, height);

  // Header
  const headerHeight = 80;
  ctx.fillStyle = '#111827';
  ctx.fillRect(0, 0, width, headerHeight);

  // Title
  ctx.fillStyle = COLORS.text;
  ctx.font = 'bold 24px Inter, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('📊 Telemetry Comparison', 20, 35);

  // Lap info
  const lap1Info = lap1 
    ? `Lap ${lap1.lapNumber}: ${formatLapTime(lap1.lapTime)} (${lap1.carName})`
    : 'No lap selected';
  const lap2Info = lap2 
    ? `Lap ${lap2.lapNumber}: ${formatLapTime(lap2.lapTime)} (${lap2.carName})`
    : 'No lap selected';

  ctx.font = '14px Inter, system-ui, sans-serif';
  
  // Lap 1 legend (blue)
  ctx.fillStyle = COLORS.lap1.line;
  ctx.fillRect(20, 50, 20, 3);
  ctx.fillStyle = COLORS.text;
  ctx.fillText(lap1Info, 50, 55);

  // Lap 2 legend (red dashed)
  ctx.fillStyle = COLORS.lap2.line;
  ctx.fillRect(400, 50, 8, 3);
  ctx.fillRect(412, 50, 8, 3);
  ctx.fillStyle = COLORS.text;
  ctx.fillText(lap2Info, 430, 55);

  // Track name
  const trackName = lap1?.trackName || lap2?.trackName || 'Unknown Track';
  ctx.fillStyle = COLORS.textSecondary;
  ctx.textAlign = 'right';
  ctx.fillText(trackName, width - 20, 35);

  // Delta
  if (lap1 && lap2) {
    const delta = lap2.lapTime - lap1.lapTime;
    const deltaStr = delta >= 0 ? `+${delta.toFixed(3)}s` : `${delta.toFixed(3)}s`;
    ctx.fillStyle = delta > 0 ? '#EF4444' : '#10B981';
    ctx.font = 'bold 16px Inter, system-ui, sans-serif';
    ctx.fillText(`Δ ${deltaStr}`, width - 20, 55);
  }

  // Charts
  const chartAreaY = headerHeight + 10;
  const chartAreaHeight = height - chartAreaY - 10;
  const chartHeight = chartAreaHeight / CHART_CONFIGS.length;

  CHART_CONFIGS.forEach((config, index) => {
    renderChart(
      ctx,
      0,
      chartAreaY + index * chartHeight,
      width,
      chartHeight,
      config,
      lap1,
      lap2
    );
  });

  // Return as base64
  return canvas.toDataURL('image/png', 1.0);
}

/**
 * Download comparison image
 */
export async function downloadComparisonImage(
  lap1: LapData | null,
  lap2: LapData | null,
  filename?: string
): Promise<void> {
  const base64 = await generateComparisonImage(lap1, lap2);
  
  const link = document.createElement('a');
  link.href = base64;
  link.download = filename || `lap-comparison-${Date.now()}.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export const ChartRenderer = {
  generateComparisonImage,
  downloadComparisonImage,
};

export default ChartRenderer;
