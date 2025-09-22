import type { PQRSTPoint } from './pqrstDetector';

export interface ECGIntervals {
  rr: number;       // RR interval in ms
  pr: number;       // PR interval in ms
  qrs: number;      // QRS duration in ms
  qt: number;       // QT interval in ms
  qtc: number;      // Corrected QT interval in ms
  bpm: number;      // Heart rate in bpm
  status: {         // Status indicators for each interval
    rr: 'normal' | 'short' | 'long' | 'unknown';
    pr: 'normal' | 'short' | 'long' | 'unknown';
    qrs: 'normal' | 'wide' | 'unknown';
    qt: 'normal' | 'prolonged' | 'unknown';
    qtc: 'normal' | 'prolonged' | 'unknown';
    bpm: 'normal' | 'bradycardia' | 'tachycardia' | 'unknown';
  };
}

export class ECGIntervalCalculator {
  private sampleRate: number;
  private gender: 'male' | 'female' = 'male';
  private lastIntervals: ECGIntervals | null = null;
  
  constructor(sampleRate: number = 360) { // Updated default from 500 to 360
    this.sampleRate = sampleRate;
  }
  
  setGender(gender: 'male' | 'female') {
    this.gender = gender;
  }
  
  /**
   * Calculate all ECG intervals from PQRST points
   * @param pqrstPoints Array of detected PQRST points
   * @returns ECG intervals or null if not enough points
   */
  calculateIntervals(pqrstPoints: PQRSTPoint[]): ECGIntervals | null {
    // Group points by their PQRST complex
    const complexes = this.groupIntoComplexes(pqrstPoints);
    
    // Need at least one complete complex to calculate intervals
    if (complexes.length < 1) {
      return this.lastIntervals;
    }
    
    // Use the most recent complex for calculations
    const latestComplex = complexes[complexes.length - 1];
    
    // Check if complex has all required points
    if (!this.isCompleteComplex(latestComplex)) {
      return this.lastIntervals;
    }
    
    // Calculate RR interval (need at least 2 complexes)
    let rrInterval = 0;
    if (complexes.length >= 2) {
      const currentR = this.findPointByType(latestComplex, 'R');
      const previousR = this.findPointByType(complexes[complexes.length - 2], 'R');
      
      if (currentR && previousR) {
        const sampleDiff = Math.abs(currentR.absolutePosition - previousR.absolutePosition);
        rrInterval = (sampleDiff / this.sampleRate) * 1000; // Convert to ms
      }
    }
    
    // If we don't have RR interval yet, try to use the global RR from BPM
    if (rrInterval === 0 && this.lastIntervals?.rr) {
      rrInterval = this.lastIntervals.rr;
    }
    
    // Calculate heart rate from RR interval
    const bpm = rrInterval > 0 ? 60000 / rrInterval : 0;
    
    // Calculate PR interval
    const pPoint = this.findPointByType(latestComplex, 'P');
    const qPoint = this.findPointByType(latestComplex, 'Q');
    const prInterval = (pPoint && qPoint) ? 
      ((qPoint.index - pPoint.index) / this.sampleRate) * 1000 : 0;
    
    // Calculate QRS duration
    const qPoint2 = this.findPointByType(latestComplex, 'Q');
    const sPoint = this.findPointByType(latestComplex, 'S');
    const qrsDuration = (qPoint2 && sPoint) ? 
      ((sPoint.index - qPoint2.index) / this.sampleRate) * 1000 : 0;
    
    // Calculate QT interval
    const tPoint = this.findPointByType(latestComplex, 'T');
    const qtInterval = (qPoint2 && tPoint) ? 
      ((tPoint.index - qPoint2.index) / this.sampleRate) * 1000 : 0;
    
    // If RR interval isn't available, try to get it from BPM
    if (rrInterval < 100 && bpm > 0) {
      rrInterval = 60000 / bpm;
    }
    
    // Calculate QTc using Bazett's formula
    const qtcInterval = (qtInterval > 0 && rrInterval >= 100) ? 
      qtInterval / Math.sqrt(rrInterval / 1000) : 0;
    
    // Determine status for each interval
    const status = {
      rr: this.getRRStatus(rrInterval),
      pr: this.getPRStatus(prInterval),
      qrs: this.getQRSStatus(qrsDuration),
      qt: this.getQTStatus(qtInterval),
      qtc: this.getQTcStatus(qtcInterval),
      bpm: this.getBPMStatus(bpm)
    };
    
    // Store the results
    this.lastIntervals = {
      rr: rrInterval,
      pr: prInterval,
      qrs: qrsDuration,
      qt: qtInterval,
      qtc: qtcInterval,
      bpm: bpm,
      status
    };
    
    
    return this.lastIntervals;
  }
  
  /**
   * Groups PQRST points into cardiac complexes
   * Updated for 360Hz sampling rate - improved temporal resolution
   */
  private groupIntoComplexes(points: PQRSTPoint[]): PQRSTPoint[][] {
    if (points.length === 0) return [];
    
    // Sort points by position
    const sortedPoints = [...points].sort((a, b) => a.absolutePosition - b.absolutePosition);
    
    const complexes: PQRSTPoint[][] = [];
    let currentComplex: PQRSTPoint[] = [];
    let lastRPosition = -1;
    
    // Minimum distance between R waves for 360Hz (approximately 216 samples = 600ms at 360Hz)
    const minRRDistance = Math.floor(this.sampleRate * 0.6); // 600ms minimum
    
    // Group points by R wave
    for (const point of sortedPoints) {
      if (point.type === 'R') {
        // Check if this R wave is far enough from the last one
        if (lastRPosition !== -1 && 
            Math.abs(point.absolutePosition - lastRPosition) < minRRDistance) {
          // Too close to previous R wave, skip this one (likely noise)
          continue;
        }
        
        // If we already have an R wave, start a new complex
        if (lastRPosition !== -1) {
          complexes.push(currentComplex);
          currentComplex = [];
        }
        lastRPosition = point.absolutePosition;
      }
      
      currentComplex.push(point);
    }
    
    // Add the last complex
    if (currentComplex.length > 0) {
      complexes.push(currentComplex);
    }
    
    return complexes;
  }
  
  /**
   * Checks if a complex has all required PQRST points
   */
  private isCompleteComplex(complex: PQRSTPoint[]): boolean {
    const types = complex.map(p => p.type);
    return (
      types.includes('P') && 
      types.includes('Q') && 
      types.includes('R') && 
      types.includes('S') && 
      types.includes('T')
    );
  }
  
  /**
   * Finds a point by type in a complex
   */
  private findPointByType(complex: PQRSTPoint[], type: string): PQRSTPoint | null {
    return complex.find(p => p.type === type) || null;
  }
  
  /**
   * Status determination methods based on clinical ranges
   * Updated thresholds optimized for 360Hz precision
   */
  private getRRStatus(rr: number): 'normal' | 'short' | 'long' | 'unknown' {
    if (rr === 0) return 'unknown';
    if (rr < 600) return 'short';   // <600ms (>100 BPM)
    if (rr > 1000) return 'long';   // >1000ms (<60 BPM)
    return 'normal';
  }
  
  private getPRStatus(pr: number): 'normal' | 'short' | 'long' | 'unknown' {
    if (pr === 0) return 'unknown';
    if (pr < 120) return 'short';   // <120ms (shorter than normal conduction)
    if (pr > 200) return 'long';    // >200ms (1st degree AV block threshold)
    return 'normal';
  }
  
  private getQRSStatus(qrs: number): 'normal' | 'wide' | 'unknown' {
    if (qrs === 0) return 'unknown';
    if (qrs > 120) return 'wide';   // >120ms (bundle branch block threshold)
    return 'normal';
  }
  
  private getQTStatus(qt: number): 'normal' | 'prolonged' | 'unknown' {
    if (qt === 0) return 'unknown';
    // Gender-specific QT thresholds (uncorrected)
    const threshold = this.gender === 'male' ? 440 : 460;
    if (qt > threshold) return 'prolonged';
    return 'normal';
  }
  
  private getQTcStatus(qtc: number): 'normal' | 'prolonged' | 'unknown' {
    if (qtc === 0) return 'unknown';
    // Gender-specific QTc thresholds (Bazett corrected)
    const threshold = this.gender === 'male' ? 450 : 470;
    if (qtc > threshold) return 'prolonged';
    return 'normal';
  }
  
  private getBPMStatus(bpm: number): 'normal' | 'bradycardia' | 'tachycardia' | 'unknown' {
    if (bpm === 0) return 'unknown';
    if (bpm < 60) return 'bradycardia';   // <60 BPM
    if (bpm > 100) return 'tachycardia';  // >100 BPM
    return 'normal';
  }
  
  /**
   * Get the last calculated intervals
   */
  getLastIntervals(): ECGIntervals | null {
    return this.lastIntervals;
  }
  
  /**
   * Reset the calculator
   */
  reset(): void {
    this.lastIntervals = null;
  }
  
  /**
   * Validate interval measurements for 360Hz sampling rate
   * @param intervals Calculated intervals to validate
   * @returns true if intervals are physiologically reasonable
   */
  validateIntervals(intervals: ECGIntervals): boolean {
    // Check for physiologically reasonable values at 360Hz precision
    if (intervals.rr > 0 && (intervals.rr < 300 || intervals.rr > 3000)) return false;
    if (intervals.pr > 0 && (intervals.pr < 80 || intervals.pr > 400)) return false;
    if (intervals.qrs > 0 && (intervals.qrs < 40 || intervals.qrs > 200)) return false;
    if (intervals.qt > 0 && (intervals.qt < 200 || intervals.qt > 600)) return false;
    if (intervals.qtc > 0 && (intervals.qtc < 300 || intervals.qtc > 700)) return false;
    if (intervals.bpm > 0 && (intervals.bpm < 20 || intervals.bpm > 300)) return false;
    
    return true;
  }
  
  /**
   * Get sample rate for external reference
   */
  getSampleRate(): number {
    return this.sampleRate;
  }
}