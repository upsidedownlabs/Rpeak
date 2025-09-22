import { PanTompkinsDetector } from "./panTompkinsDetector";

export class BPMCalculator {
  private bpmWindow: number[] = [];
  private bpmSmooth: number | null = null;
  private sampleRate: number;
  private windowSize: number;
  private minBPM: number;
  private maxBPM: number;
  private refractoryPeriod: number;
  private minDistance: number;

  constructor(
    sampleRate: number = 360,
    windowSize: number = 5,
    minBPM: number = 40,
    maxBPM: number = 200
  ) {
    this.sampleRate = sampleRate;
    this.windowSize = windowSize;
    this.minBPM = minBPM;
    this.maxBPM = maxBPM;
    this.refractoryPeriod = Math.floor(sampleRate * 0.2); // 200ms refractory period = 72 samples at 360Hz
    this.minDistance = Math.floor(sampleRate * 0.08); // 80ms minimum distance = 29 samples at 360Hz
  }

  /**
   * Detect peaks in ECG data
   * @param data - Array of ECG values
   * @returns Array of peak indices
   */
  detectPeaks(data: number[]): number[] {
    const peaks: number[] = [];
    const dataLength = data.length;

    // Calculate dynamic threshold based on signal characteristics
    const sortedAmplitudes = [...data].sort((a, b) => b - a);
    const top5Percent = sortedAmplitudes.slice(0, Math.floor(dataLength * 0.05));

    // Use a higher threshold - 50% of the average of top 5% amplitudes
    const dynamicThreshold =
      top5Percent.length > 0
        ? (top5Percent.reduce((sum, val) => sum + val, 0) / top5Percent.length) * 0.5
        : 0.2; // Fallback

    // R peaks should be positive, so use a direct threshold rather than absolute value
    const threshold = Math.max(0.1, dynamicThreshold);



    // Look for peaks that exceed the threshold and are local maxima
    for (let i = this.minDistance; i < dataLength - this.minDistance; i++) {
      // Skip if not above threshold (R peaks are positive deflections)
      if (data[i] < threshold) continue;

      // Check if this is a local maximum
      let isPeak = true;
      for (let j = Math.max(0, i - this.minDistance); j <= Math.min(dataLength - 1, i + this.minDistance); j++) {
        if (j !== i && data[j] > data[i]) {
          isPeak = false;
          break;
        }
      }

      if (isPeak) {
        peaks.push(i);

        // Skip ahead to avoid detecting the same peak twice
        i += this.minDistance;
      }
    }

    // Further filtering - keep only the highest peaks if there are too many
    // Adjusted for 1000 points buffer
    const maxPeaksFor1000Points = Math.floor(1000 / (this.sampleRate * 0.6)); // ~5 peaks max for 1000 points
    if (peaks.length > maxPeaksFor1000Points) {
      // Sort peaks by amplitude
      const peaksByAmplitude = [...peaks].sort((a, b) => data[b] - data[a]);
      // Keep only the top peaks
      const topPeaks = peaksByAmplitude.slice(0, maxPeaksFor1000Points);
      // Re-sort by position
      peaks.length = 0;
      peaks.push(...topPeaks.sort((a, b) => a - b));
    }

    return this.filterPeaksByRate(peaks);
  }

  /**
   * Filter peaks by refractory period to avoid double-counting
   * @param peaks - Array of peak indices
   * @returns Filtered array of peak indices
   */
  private filterPeaksByRate(peaks: number[]): number[] {
    if (peaks.length === 0) return [];
    const filtered: number[] = [];
    let lastPeak = -Infinity;
    for (const peak of peaks) {
      if (peak - lastPeak >= this.refractoryPeriod) {
        filtered.push(peak);
        lastPeak = peak;
      }
    }
    return filtered;
  }

  /**
   * Calculate BPM from peak intervals
   * @param peaks - Array of peak indices
   * @returns BPM value or null if invalid
   */
  calculateBPMFromPeaks(peaks: number[]): number | null {
    if (peaks.length < 2) return null;

    // Calculate intervals between consecutive peaks
    const intervals = peaks.slice(1).map((peak, index) => peak - peaks[index]);

    // Average interval
    const averageInterval = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;

    // Convert to BPM
    const bpm = (60 * this.sampleRate) / averageInterval;

    // Validate BPM range
    if (bpm < this.minBPM || bpm > this.maxBPM) {
      return null;
    }

    return bpm;
  }

  /**
   * Smooth BPM using moving average and rate limiting
   * @param newBPM - New BPM value
   * @returns Smoothed BPM
   */
  smoothBPM(newBPM: number): number {
    // Add to sliding window
    this.bpmWindow.push(newBPM);
    if (this.bpmWindow.length > this.windowSize) {
      this.bpmWindow.shift();
    }

    // Calculate moving average
    const windowAverage = this.bpmWindow.reduce((sum, bpm) => sum + bpm, 0) / this.bpmWindow.length;

    // Apply rate limiting for smooth transitions
    if (this.bpmSmooth === null) {
      this.bpmSmooth = windowAverage;
    } else {
      const maxChange = 2; // Maximum BPM change per update
      const difference = windowAverage - this.bpmSmooth;
      const limitedChange = Math.sign(difference) * Math.min(maxChange, Math.abs(difference));
      this.bpmSmooth += limitedChange;
    }

    return this.bpmSmooth;
  }

  /**
   * Complete BPM calculation pipeline
   * @param data - ECG data array
   * @returns Smoothed BPM or null
   */
  computeBPM(data: number[]): number | null {
    // Use QRS-specific peak detection
    const peaks = getQRSPeaks(data, this.sampleRate);
    const rawBPM = this.calculateBPMFromPeaks(peaks);

    if (rawBPM === null) return null;

    return this.smoothBPM(rawBPM);
  }

  /**
   * Generate peak visualization data for 1000 points
   * @param data - ECG data array (1000 points)
   * @param peaks - Peak indices
   * @returns Array for peak visualization (1000 points)
   */
  generatePeakVisualization(data: number[], peaks: number[]): number[] {
    const peakData = new Array(data.length).fill(0);

    peaks.forEach(peakIndex => {
      const peakValue = data[peakIndex];
      // Create peak markers - adjusted for 360Hz and 1000 points
      const markerWidth = Math.floor(this.sampleRate * 0.02); // 20ms marker width = ~7 samples at 360Hz
      for (let j = peakIndex - markerWidth; j <= peakIndex + markerWidth; j++) {
        if (j >= 0 && j < data.length) {
          peakData[j] = peakValue + 0.03; // Slight offset above peak
        }
      }
    });

    return peakData;
  }

  /**
   * Reset calculator state
   */
  reset(): void {
    this.bpmWindow = [];
    this.bpmSmooth = null;
  }

  /**
   * Get current BPM statistics
   */
  getStats(): {
    currentBPM: number | null;
    averageBPM: number | null;
    windowSize: number;
    sampleCount: number;
  } {
    const averageBPM = this.bpmWindow.length > 0
      ? this.bpmWindow.reduce((sum, bpm) => sum + bpm, 0) / this.bpmWindow.length
      : null;

    return {
      currentBPM: this.bpmSmooth,
      averageBPM,
      windowSize: this.windowSize,
      sampleCount: this.bpmWindow.length
    };
  }

  /**
   * QRS-specific filtering: amplitude and slope
   */
  public filterQRS(signal: number[], peakIdx: number, sampleRate: number): boolean {
    const window = Math.floor(0.04 * sampleRate); // 40ms before/after = ~14 samples at 360Hz
    const start = Math.max(peakIdx - window, 0);
    const end = Math.min(peakIdx + window, signal.length - 1);
    const segment = signal.slice(start, end);

    const amplitude = Math.max(...segment) - Math.min(...segment);
    let maxSlope = 0;
    for (let i = 1; i < segment.length; i++) {
      maxSlope = Math.max(maxSlope, Math.abs(segment[i] - segment[i - 1]));
    }
    const qrsWidth = end - start;

    // Stricter criteria (adjusted for 360Hz)
    return amplitude > 0.6 && maxSlope > 0.4 && qrsWidth < Math.floor(0.12 * sampleRate); // 120ms = ~43 samples at 360Hz
  }
}

/**
 * Peak detection with threshold and refractory period
 */
export function detectRPeaks(
  signal: number[],
  sampleRate: number,
  threshold: number = 0.35,
  refractoryMs: number = 300
): number[] {
  const refractorySamples = Math.floor(refractoryMs * sampleRate / 1000); // ~108 samples at 360Hz
  const peaks: number[] = [];
  let lastPeak = -refractorySamples;

  for (let i = 1; i < signal.length - 1; i++) {
    if (
      signal[i] > threshold &&
      signal[i] > signal[i - 1] &&
      signal[i] > signal[i + 1] &&
      (i - lastPeak) > refractorySamples
    ) {
      peaks.push(i);
      lastPeak = i;
    }
  }
  return peaks;
}

/**
 * QRS-specific filtering: amplitude and slope
 */
export function filterQRS(signal: number[], peakIdx: number, sampleRate: number): boolean {
  const window = Math.floor(0.04 * sampleRate); // 40ms before/after = ~14 samples at 360Hz
  const start = Math.max(peakIdx - window, 0);
  const end = Math.min(peakIdx + window, signal.length - 1);
  const segment = signal.slice(start, end);

  const amplitude = Math.max(...segment) - Math.min(...segment);
  let maxSlope = 0;
  for (let i = 1; i < segment.length; i++) {
    maxSlope = Math.max(maxSlope, Math.abs(segment[i] - segment[i - 1]));
  }
  const qrsWidth = end - start;

  // Stricter criteria (adjusted for 360Hz)
  return amplitude > 0.6 && maxSlope > 0.4 && qrsWidth < Math.floor(0.12 * sampleRate); // 120ms = ~43 samples at 360Hz
}

/**
 * Usage: filter detected peaks
 */
export function getQRSPeaks(signal: number[], sampleRate: number): number[] {
  const rawPeaks = detectRPeaks(signal, sampleRate, 0.35, 300);
  return rawPeaks.filter(idx => filterQRS(signal, idx, sampleRate));
}

/**
 * Get R-peaks using multiple methods for robustness
 */
export function getRPeaks(signal: number[], sampleRate: number): number[] {
  // 1. Try Pan-Tompkins first
  const panTompkins = new PanTompkinsDetector(sampleRate);
  let peaks = panTompkins.detectQRS(signal);

  // 2. If Pan-Tompkins fails (no peaks), fallback to simple detection + QRS filtering
  if (!peaks || peaks.length === 0) {
    const rawPeaks = detectRPeaks(signal, sampleRate, 0.25, 300);
    peaks = rawPeaks.filter(idx => filterQRS(signal, idx, sampleRate));
  } else {
    // Also filter Pan-Tompkins peaks by QRS morphology for extra robustness
    peaks = peaks.filter(idx => filterQRS(signal, idx, sampleRate));
  }

  return peaks;
}