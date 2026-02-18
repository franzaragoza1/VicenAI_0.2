/**
 * Test Lap Comparison
 * 
 * Generates fake lap data and renders comparison image for testing.
 * Run from browser console or import into a test component.
 */

import { LapData, TelemetryPoint } from '../services/lap-api';
import { generateComparisonImage } from './chart-renderer';

/**
 * Generate realistic-looking telemetry data for a lap
 */
function generateFakeLap(
  lapNumber: number,
  lapTime: number,
  trackName: string,
  carName: string,
  isSessionBest: boolean,
  variation: 'smooth' | 'aggressive' = 'smooth'
): LapData {
  const points: TelemetryPoint[] = [];
  const numPoints = 1000; // ~50 seconds at 20Hz
  
  // Track sections (simplified)
  // Each section: [startPct, endPct, type]
  const sections: Array<[number, number, 'straight' | 'corner' | 'chicane']> = [
    [0, 0.15, 'straight'],      // Start straight
    [0.15, 0.25, 'corner'],     // Turn 1
    [0.25, 0.35, 'straight'],   // Short straight
    [0.35, 0.45, 'chicane'],    // Chicane
    [0.45, 0.60, 'straight'],   // Back straight
    [0.60, 0.70, 'corner'],     // Hairpin
    [0.70, 0.80, 'straight'],   // Acceleration zone
    [0.80, 0.90, 'corner'],     // Final corner
    [0.90, 1.0, 'straight'],    // Finish straight
  ];

  for (let i = 0; i < numPoints; i++) {
    const distancePct = i / numPoints;
    
    // Find current section
    let sectionType: 'straight' | 'corner' | 'chicane' = 'straight';
    for (const [start, end, type] of sections) {
      if (distancePct >= start && distancePct < end) {
        sectionType = type;
        break;
      }
    }

    // Base values depending on section
    let baseSpeed: number;
    let baseThrottle: number;
    let baseBrake: number;
    let baseGear: number;
    let baseSteering: number;

    switch (sectionType) {
      case 'straight':
        baseSpeed = 280 + Math.sin(distancePct * Math.PI * 2) * 20;
        baseThrottle = 0.95;
        baseBrake = 0;
        baseGear = 7;
        baseSteering = 0;
        break;
      case 'corner':
        const cornerProgress = (distancePct % 0.1) / 0.1;
        if (cornerProgress < 0.3) {
          // Braking zone
          baseSpeed = 280 - cornerProgress * 150;
          baseThrottle = 0;
          baseBrake = 0.9 - cornerProgress * 0.5;
          baseGear = 7 - Math.floor(cornerProgress * 4);
        } else if (cornerProgress < 0.7) {
          // Apex
          baseSpeed = 120 + (cornerProgress - 0.3) * 50;
          baseThrottle = 0.3 + (cornerProgress - 0.3) * 0.5;
          baseBrake = 0;
          baseGear = 3;
        } else {
          // Exit
          baseSpeed = 140 + (cornerProgress - 0.7) * 200;
          baseThrottle = 0.8 + (cornerProgress - 0.7) * 0.3;
          baseBrake = 0;
          baseGear = 4 + Math.floor((cornerProgress - 0.7) * 6);
        }
        baseSteering = Math.sin(cornerProgress * Math.PI) * 0.8;
        break;
      case 'chicane':
        const chicaneProgress = (distancePct % 0.1) / 0.1;
        baseSpeed = 150 + Math.sin(chicaneProgress * Math.PI * 4) * 30;
        baseThrottle = 0.5 + Math.sin(chicaneProgress * Math.PI * 4) * 0.3;
        baseBrake = Math.max(0, -Math.sin(chicaneProgress * Math.PI * 4) * 0.3);
        baseGear = 4;
        baseSteering = Math.sin(chicaneProgress * Math.PI * 4) * 0.5;
        break;
    }

    // Add variation based on driving style
    const variationFactor = variation === 'aggressive' ? 1.2 : 1.0;
    const noise = (Math.random() - 0.5) * 0.05 * variationFactor;

    // Add some random variation
    points.push({
      distancePct,
      speed: Math.max(0, baseSpeed * (1 + noise)),
      throttle: Math.max(0, Math.min(1, baseThrottle * (1 + noise))),
      brake: Math.max(0, Math.min(1, baseBrake * (1 + noise))),
      gear: Math.max(1, Math.min(8, Math.round(baseGear))),
      rpm: 6000 + baseSpeed * 20 + Math.random() * 500,
      steeringAngle: baseSteering * (1 + noise * 2),
    });
  }

  return {
    id: `fake-lap-${lapNumber}`,
    lapNumber,
    lapTime,
    isSessionBest,
    trackName,
    carName,
    completedAt: Date.now() - (10 - lapNumber) * 60000,
    points,
    deltaToSessionBest: isSessionBest ? 0 : lapTime - 62.5,
  };
}

/**
 * Test the comparison chart generation with fake data
 */
export async function testComparisonChart(): Promise<string> {
  console.log('[TestComparison] Generating fake lap data...');
  
  // Generate two laps with different characteristics
  const lap1 = generateFakeLap(
    5,
    62.571,
    'Sachsenring - GP',
    'Mazda MX-5 Cup',
    true,
    'smooth'
  );
  
  const lap2 = generateFakeLap(
    3,
    63.245,
    'Sachsenring - GP',
    'Mazda MX-5 Cup',
    false,
    'aggressive'
  );
  
  console.log(`[TestComparison] Lap 1: ${lap1.lapTime}s (${lap1.points.length} points)`);
  console.log(`[TestComparison] Lap 2: ${lap2.lapTime}s (${lap2.points.length} points)`);
  
  // Generate comparison image
  console.log('[TestComparison] Generating comparison chart...');
  const imageBase64 = await generateComparisonImage(lap1, lap2);
  
  console.log(`[TestComparison] Image generated: ${imageBase64.length} chars`);
  
  return imageBase64;
}

/**
 * Open the test image in a new window
 */
export async function showTestComparisonImage(): Promise<void> {
  const imageBase64 = await testComparisonChart();
  
  // Create a new window with the image
  const imgWindow = window.open('', '_blank');
  if (imgWindow) {
    imgWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Lap Comparison Test</title>
          <style>
            body { 
              margin: 0; 
              background: #111; 
              display: flex; 
              justify-content: center; 
              align-items: center;
              min-height: 100vh;
            }
            img { 
              max-width: 100%; 
              height: auto; 
              box-shadow: 0 4px 20px rgba(0,0,0,0.5);
            }
          </style>
        </head>
        <body>
          <img src="${imageBase64}" alt="Lap Comparison Chart" />
        </body>
      </html>
    `);
    imgWindow.document.close();
  }
}

/**
 * Download the test image
 */
export async function downloadTestComparisonImage(): Promise<void> {
  const imageBase64 = await testComparisonChart();
  
  // Create download link
  const link = document.createElement('a');
  link.href = imageBase64;
  link.download = 'lap-comparison-test.png';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  console.log('[TestComparison] Image downloaded');
}

// Export to window for easy console access
if (typeof window !== 'undefined') {
  (window as any).testLapComparison = {
    generate: testComparisonChart,
    show: showTestComparisonImage,
    download: downloadTestComparisonImage,
  };
  console.log('[TestComparison] Test functions available:');
  console.log('  - testLapComparison.show()     → Open image in new window');
  console.log('  - testLapComparison.download() → Download image as PNG');
  console.log('  - testLapComparison.generate() → Get base64 string');
}
