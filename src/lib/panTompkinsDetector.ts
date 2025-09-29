export class PanTompkinsDetector {
  private sampleRate: number;
  private usePrefiltered: boolean;
  private prevFiltered: number[] = [];
  private prevDifferentiated: number[] = [];
  private prevSquared: number[] = [];
  private prevIntegrated: number[] = [];
  
  // Learning rates for threshold adaptation
  private learningRateSignal = 0.125; // EMA constant
  private learningRateNoise = 0.125;  // EMA constant
  
  // Initial thresholds
  private signalThreshold = 0.25;
  private noiseThreshold = 0.1;
  
  // Peak tracking
  private peakAmp: number[] = [];
  private peakLoc: number[] = [];
  private noiseAmp: number[] = [];
  private noiseLoc: number[] = [];
  
  constructor(sampleRate: number = 360, usePrefiltered: boolean = true) {
    this.sampleRate = sampleRate;
    this.usePrefiltered = usePrefiltered;
  }
  
  reset() {
    this.prevFiltered = [];
    this.prevDifferentiated = [];
    this.prevSquared = [];
    this.prevIntegrated = [];
    this.peakAmp = [];
    this.peakLoc = [];
    this.noiseAmp = [];
    this.noiseLoc = [];
    this.signalThreshold = 0.25;
    this.noiseThreshold = 0.1;
  }
  
  detectQRS(data: number[]): number[] {
    // 1. Bandpass filtering (5-15Hz) or use prefiltered
    const filtered = this.bandpassFilter(data);
    
    // 2. Normalize filtered signal (optional but recommended)
    const mean = filtered.reduce((s, v) => s + v, 0) / filtered.length;
    const std = Math.sqrt(filtered.reduce((s, v) => s + (v - mean) ** 2, 0) / filtered.length) || 1;
    const norm = filtered.map(v => (v - mean) / std);
    this.prevFiltered = norm;
    
    // 3. Differentiation (critical fix: scale correctly)
    const differentiated = this.differentiate(norm);
    
    // 4. Squaring
    const squared = this.square(differentiated);
    
    // 5. Moving window integration (150ms window)
    const windowSize = Math.round(this.sampleRate * 0.15); // 54 samples at 360Hz
    const integrated = this.movingWindowIntegrate(squared, windowSize);
    
    // 6. Adaptive thresholding and peak detection
    const rPeaks = this.findPeaks(integrated, norm);
    
    return rPeaks;
  }
  
  private bandpassFilter(data: number[]): number[] {
    if (this.usePrefiltered) {
      this.prevFiltered = data.slice();
      return this.prevFiltered;
    }
    // Updated IIR bandpass filter coefficients for 360Hz sampling rate
    // Butterworth bandpass filter (5-15Hz) designed for 360Hz
    const a = [1, -1.5267, 0.5763]; // Denominator coefficients for 360Hz
    const b = [0.1816, 0, -0.1816]; // Numerator coefficients for 360Hz
    
    const filtered = new Array(data.length).fill(0);
    
    // Apply filter
    for (let i = 0; i < data.length; i++) {
      filtered[i] = b[0] * data[i];
      
      if (i >= 1) {
        filtered[i] += b[1] * data[i-1] - a[1] * filtered[i-1];
      }
      
      if (i >= 2) {
        filtered[i] += b[2] * data[i-2] - a[2] * filtered[i-2];
      }
    }
    
    this.prevFiltered = filtered;
    return filtered;
  }
  
  // FIX 1: Correct derivative scaling
  private differentiate(data: number[]): number[] {
    const output = new Array(data.length).fill(0);
    const fsScale = this.sampleRate / 360;
    for (let i = 2; i < data.length - 2; i++) {
      output[i] = (2 * data[i + 2] + data[i + 1] - data[i - 1] - 2 * data[i - 2]) * (fsScale / 8);
    }
    this.prevDifferentiated = output;
    return output;
  }
  
  private square(data: number[]): number[] {
    const output = data.map(x => x * x);
    this.prevSquared = output;
    return output;
  }
  
  private movingWindowIntegrate(data: number[], windowSize: number): number[] {
    const output = new Array(data.length).fill(0);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i];
      if (i >= windowSize) sum -= data[i - windowSize];
      output[i] = sum / windowSize;
    }
    this.prevIntegrated = output;
    return output;
  }
  
  private findPeaks(integrated: number[], filtered: number[]): number[] {
    const rPeaks: number[] = [];
    const dataLength = integrated.length;
    
    // FIX 5: Use ~200ms refractory
    const minDistance = Math.round(this.sampleRate * 0.2); // 72 samples at 360Hz
    
    // FIX 7: Guard for short signals
    if (dataLength < 5) return [];
    
    // Init with robust threshold
    if (this.peakAmp.length === 0) {
      const sortedData = [...integrated].sort((a, b) => b - a);
      const idx = Math.max(0, Math.floor(sortedData.length * 0.05));
      const topValue = sortedData[idx] ?? sortedData[0] ?? 0;
      this.signalThreshold = topValue * 0.6;
      this.noiseThreshold = topValue * 0.2;
    }
    
    // Find all peaks
    for (let i = 1; i < dataLength - 1; i++) {
      // Check if this is a local maximum
      if (integrated[i] > integrated[i-1] && integrated[i] >= integrated[i+1]) {
        // Check if it's a signal or noise
        if (integrated[i] > this.signalThreshold) {
          // FIX 4: >= and replace-if-larger inside refractory
          const lastPeakIdx = this.peakLoc.length > 0 ? this.peakLoc[this.peakLoc.length - 1] : -minDistance * 10;
          
          if (i - lastPeakIdx >= minDistance) {
            // It's a valid peak
            rPeaks.push(i);
            this.peakAmp.push(integrated[i]);
            this.peakLoc.push(i);
            
            // FIX 3: EMA update for signalThreshold
            const peakAvg = this.peakAmp.slice(-8).reduce((sum, val) => sum + val, 0) / Math.min(8, this.peakAmp.length);
            this.signalThreshold = 0.875 * this.signalThreshold + 0.125 * Math.max(this.noiseThreshold + 0.25 * (peakAvg - this.noiseThreshold), 1e-6);
          } else {
            // inside refractory — if current > last recorded, replace it
            if (this.peakAmp.length && integrated[i] > this.peakAmp[this.peakAmp.length - 1]) {
              this.peakAmp[this.peakAmp.length - 1] = integrated[i];
              this.peakLoc[this.peakLoc.length - 1] = i;
            }
          }
        } else if (integrated[i] > this.noiseThreshold) {
          this.noiseAmp.push(integrated[i]);
          this.noiseLoc.push(i);
          // FIX 3: EMA update for noiseThreshold
          const noiseAvg = this.noiseAmp.slice(-8).reduce((sum, val) => sum + val, 0) / Math.min(8, this.noiseAmp.length);
          this.noiseThreshold = 0.875 * this.noiseThreshold + 0.125 * Math.max(noiseAvg, 1e-6);
        }
      }
    }
    
    // FIX 2: Refine in filtered signal, use abs and adaptive threshold
    const recentPeakAvg = this.peakAmp.length
      ? this.peakAmp.slice(-8).reduce((s, v) => s + v, 0) / Math.min(8, this.peakAmp.length)
      : 0;
    const ampThresh = recentPeakAvg ? Math.max(0.25 * recentPeakAvg, 1e-6) : 1e-6;
    
    const refinedPeaks: number[] = [];
    for (const peakIdx of rPeaks) {
      const searchWindow = Math.round(this.sampleRate * 0.03); // ~30ms
      const s = Math.max(0, peakIdx - searchWindow);
      const e = Math.min(filtered.length - 1, peakIdx + searchWindow);
      
      let maxVal = Math.abs(filtered[s] ?? 0);
      let maxIdx = s;
      for (let i = s; i <= e; i++) {
        const v = Math.abs(filtered[i] ?? 0);
        if (v > maxVal) {
          maxVal = v;
          maxIdx = i;
        }
      }
      if (maxVal >= ampThresh) refinedPeaks.push(maxIdx);
    }
    
    // Dedupe and sort
    let finalPeaks = Array.from(new Set(refinedPeaks)).sort((a, b) => a - b);

    // --- T-wave rejection: remove peaks too close to previous with much lower amplitude ---
    const rrMin = Math.round(this.sampleRate * 0.36); // 360 ms
    const tWaveFiltered: number[] = [];
    for (let i = 0; i < finalPeaks.length; i++) {
      if (i === 0) {
        tWaveFiltered.push(finalPeaks[i]);
        continue;
      }
      const currIdx = finalPeaks[i];
      const prevIdx = tWaveFiltered[tWaveFiltered.length - 1];
      const rr = currIdx - prevIdx;
      const currAmp = Math.abs(this.prevFiltered[currIdx] ?? 0);
      const prevAmp = Math.abs(this.prevFiltered[prevIdx] ?? 0);

      // If within 360ms and amplitude is much lower, reject as likely T-wave
      if (rr < rrMin && currAmp < 0.5 * prevAmp) {
        // skip this peak (likely T-wave)
        continue;
      }
      tWaveFiltered.push(currIdx);
    }
    finalPeaks = tWaveFiltered;

    return finalPeaks;
  }
  
  // For debugging/visualization
  getIntermediateSignals() {
    return {
      filtered: this.prevFiltered,
      differentiated: this.prevDifferentiated,
      squared: this.prevSquared,
      integrated: this.prevIntegrated,
      signalThreshold: this.signalThreshold,
      noiseThreshold: this.noiseThreshold
    };
  }
}