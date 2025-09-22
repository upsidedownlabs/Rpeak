export class PanTompkinsDetector {
  private sampleRate: number;
  private prevFiltered: number[] = [];
  private prevDifferentiated: number[] = [];
  private prevSquared: number[] = [];
  private prevIntegrated: number[] = [];
  
  // Learning rates for threshold adaptation
  private learningRateSignal = 0.15;
  private learningRateNoise = 0.075;
  
  // Initial thresholds
  private signalThreshold = 0.25;
  private noiseThreshold = 0.1;
  
  // Peak tracking
  private peakAmp: number[] = [];
  private peakLoc: number[] = [];
  private noiseAmp: number[] = [];
  private noiseLoc: number[] = [];
  
  constructor(sampleRate: number = 360) { // Updated default from 500 to 360
    this.sampleRate = sampleRate;
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
    // 1. Bandpass filtering (5-15Hz)
    const filtered = this.bandpassFilter(data);
    
    // 2. Differentiation
    const differentiated = this.differentiate(filtered);
    
    // 3. Squaring
    const squared = this.square(differentiated);
    
    // 4. Moving window integration
    const windowSize = Math.round(this.sampleRate * 0.15); // 150ms window = 54 samples at 360Hz
    const integrated = this.movingWindowIntegrate(squared, windowSize);
    
    // 5. Adaptive thresholding and peak detection
    const rPeaks = this.findPeaks(integrated, data);
    
    return rPeaks;
  }
  
  private bandpassFilter(data: number[]): number[] {
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
  
  private differentiate(data: number[]): number[] {
    const output = new Array(data.length).fill(0);
    
    // Five-point derivative (scaled for 360Hz sampling rate)
    const scale = this.sampleRate / 360; // Scaling factor for different sampling rates
    for (let i = 2; i < data.length - 2; i++) {
      output[i] = (2*data[i+2] + data[i+1] - data[i-1] - 2*data[i-2]) / (8 * scale);
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
    
    for (let i = 0; i < data.length; i++) {
      let sum = 0;
      for (let j = 0; j < windowSize; j++) {
        if (i - j >= 0) {
          sum += data[i - j];
        }
      }
      output[i] = sum / windowSize;
    }
    
    this.prevIntegrated = output;
    return output;
  }
  
  private findPeaks(integrated: number[], originalData: number[]): number[] {
    const rPeaks: number[] = [];
    const dataLength = integrated.length;
    
    // Minimum distance between peaks (300ms for 360Hz = 108 samples)
    const minDistance = Math.round(this.sampleRate * 0.3); // 300ms window = 108 samples at 360Hz
    
    // Init with reasonable threshold
    if (this.peakAmp.length === 0) {
      // Initialize thresholds
      const sortedData = [...integrated].sort((a, b) => b - a);
      const topValue = sortedData[Math.floor(sortedData.length * 0.05)];
      this.signalThreshold = topValue * 0.6;
      this.noiseThreshold = topValue * 0.2;
    }
    
    // Find all peaks
    for (let i = 1; i < dataLength - 1; i++) {
      // Check if this is a local maximum
      if (integrated[i] > integrated[i-1] && integrated[i] >= integrated[i+1]) {
        // Check if it's a signal or noise
        if (integrated[i] > this.signalThreshold) {
          // Check minimum distance from last detected peak
          const lastPeakIdx = this.peakLoc.length > 0 ? this.peakLoc[this.peakLoc.length - 1] : -minDistance;
          
          if (i - lastPeakIdx > minDistance) {
            // It's a valid peak
            rPeaks.push(i);
            this.peakAmp.push(integrated[i]);
            this.peakLoc.push(i);
            
            // Update signal threshold
            const peakAvg = this.peakAmp.slice(-8).reduce((sum, val) => sum + val, 0) / 
                          Math.min(8, this.peakAmp.length);
            this.signalThreshold = this.noiseThreshold + 
                                  this.learningRateSignal * (peakAvg - this.noiseThreshold);
          }
        } else if (integrated[i] > this.noiseThreshold) {
          // It's noise
          this.noiseAmp.push(integrated[i]);
          this.noiseLoc.push(i);
          
          // Update noise threshold
          const noiseAvg = this.noiseAmp.slice(-8).reduce((sum, val) => sum + val, 0) / 
                         Math.min(8, this.noiseAmp.length);
          this.noiseThreshold = this.learningRateNoise * noiseAvg;
        }
      }
    }
    
    // Now find the actual R peaks in the original data
    // (usually they are slightly offset from the integrated signal peaks)
    const refinedPeaks: number[] = [];
    
    for (const peakIdx of rPeaks) {
      // Search in a small window around the detected peak (adjusted for 360Hz)
      const searchWindow = Math.round(this.sampleRate * 0.028); // 28ms window ≈ 10 samples at 360Hz
      const searchStart = Math.max(0, peakIdx - searchWindow);
      const searchEnd = Math.min(originalData.length - 1, peakIdx + searchWindow);
      
      let maxVal = originalData[peakIdx];
      let maxIdx = peakIdx;
      
      for (let i = searchStart; i <= searchEnd; i++) {
        if (originalData[i] > maxVal) {
          maxVal = originalData[i];
          maxIdx = i;
        }
      }
      
      refinedPeaks.push(maxIdx);
    }
    
    return refinedPeaks;
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