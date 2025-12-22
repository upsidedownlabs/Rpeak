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
  // Input validation
  if (!signal || signal.length === 0) {
    console.warn('[detectRPeaksECG] Empty or invalid signal provided');
    return [];
  }
  
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    console.error('[detectRPeaksECG] Invalid sample rate:', sampleRate);
    return [];
  }
  
  const detector = new PQRSTDetector(sampleRate);
  const signalArray = Array.from(signal);
  const maxAbs = signalArray.reduce((max, x) => Math.max(max, Math.abs(x)), 0);
  const mean = signalArray.reduce((a, b) => a + b, 0) / signalArray.length;

  // First pass: direct detection
  const points = detector.detectDirectWaves(signalArray, 0);
  let peaks = points.filter(p => p.type === 'R').map(p => p.index);

  if (peaks.length > 0) {
    return peaks;
  }

  // Adaptive fallback: normalize amplitude and retry for weak signals
  if (options.adaptiveThreshold) {
    const maxAbs2 = Math.max(signalArray.reduce((max, x) => Math.max(max, Math.abs(x)), 0), 1e-6);
    if (maxAbs2 > 0) {
      const scaled = signalArray.map(x => x / maxAbs2);
      const points2 = detector.detectDirectWaves(scaled, 0);
      peaks = points2.filter(p => p.type === 'R').map(p => p.index);
    }
  }

  return peaks;
}
