import { PQRSTDetector } from './pqrstDetector';

export type RPeakOptions = {
  adaptiveThreshold?: boolean;
};

/**
 * Unified R-peak detection for live and session analysis.
 * Uses PQRSTDetector and optionally adapts amplitude for low-signal recordings.
 */
export function detectRPeaksECG(
  signal: number[] | Float32Array,
  sampleRate: number,
  options: RPeakOptions = { adaptiveThreshold: true }
): number[] {
  const detector = new PQRSTDetector(sampleRate);
  const signalArray = Array.from(signal);
  const maxAbs = Math.max(...signalArray.map(x => Math.abs(x)));
  const mean = signalArray.reduce((a, b) => a + b, 0) / signalArray.length;
  console.log(`[detectRPeaksECG] signal length=${signalArray.length}, maxAbs=${maxAbs.toFixed(4)}, mean=${mean.toFixed(4)}`);

  // First pass: direct detection
  const points = detector.detectDirectWaves(signalArray, 0);
  let peaks = points.filter(p => p.type === 'R').map(p => p.index);
  console.log(`[detectRPeaksECG] pass 1: found ${peaks.length} peaks`);

  if (peaks.length > 0) {
    console.log(`[detectRPeaksECG] returning ${peaks.length} peaks from pass 1`);
    return peaks;
  }

  // Adaptive fallback: normalize amplitude and retry for weak signals
  if (options.adaptiveThreshold) {
    const maxAbs2 = Math.max(...signalArray.map(x => Math.abs(x)), 1e-6);
    if (maxAbs2 > 0) {
      const scaled = signalArray.map(x => x / maxAbs2);
      console.log(`[detectRPeaksECG] pass 2 (adaptive): scaled by ${(1 / maxAbs2).toFixed(4)}`);
      const points2 = detector.detectDirectWaves(scaled, 0);
      peaks = points2.filter(p => p.type === 'R').map(p => p.index);
      console.log(`[detectRPeaksECG] pass 2: found ${peaks.length} peaks`);
    }
  }

  console.log(`[detectRPeaksECG] final: returning ${peaks.length} peaks`);
  return peaks;
}
