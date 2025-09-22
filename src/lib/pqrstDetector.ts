export interface PQRSTPoint {
    index: number;
    amplitude: number;
    type: 'P' | 'Q' | 'R' | 'S' | 'T';
    // Add absolute time position so we can track this point even as data moves
    absolutePosition: number;
}

export class PQRSTDetector {
    private windowSize: number;
    private sampleRate: number;
    private lastPointsMap: Map<string, PQRSTPoint[]> = new Map();

    constructor(sampleRate: number = 360) {
        this.windowSize = Math.floor(sampleRate * 0.2); // 200ms window = 72 samples at 360Hz
        this.sampleRate = sampleRate;
    }

    detectWaves(data: number[], rPeaks: number[], currentIndex: number = 0): PQRSTPoint[] {
        const pqrstPoints: PQRSTPoint[] = [];

        // Filter rPeaks to only include valid QRS complexes
        const validRPeaks = rPeaks.filter(peakIndex => this.isValidQRS(data, peakIndex));

        if (validRPeaks.length === 0) {
            return [];
        }

        // Process ALL peaks instead of just the last 5
        const peaksToProcess = validRPeaks;

        // Process each R peak to find the surrounding PQST points
        peaksToProcess.forEach((rPeakIndex, peakIdx) => {
            // Reduced edge check for 360Hz - only need 9 samples (25ms) on each side
            if (rPeakIndex < 9 || rPeakIndex >= data.length - 9) {
                return; // Skip if too close to the edges
            }

            // Calculate RR interval (distance to previous R peak)
            let rrInterval: number;
            if (peakIdx > 0) {
                // Use actual RR interval if available
                rrInterval = rPeakIndex - peaksToProcess[peakIdx - 1];
            } else if (peakIdx < peaksToProcess.length - 1) {
                // Use next RR interval if previous not available
                rrInterval = peaksToProcess[peakIdx + 1] - rPeakIndex;
            } else {
                // Fallback to default RR interval (approximately 1 second at 360Hz)
                rrInterval = this.sampleRate;
            }

            // Safety check - ensure RR interval is reasonable for 360Hz
            if (rrInterval < this.sampleRate * 0.3) {
                // Too short - probably noise, use minimum interval (300ms = 108 samples)
                rrInterval = Math.floor(this.sampleRate * 0.3);
            } else if (rrInterval > this.sampleRate * 1.5) {
                // Too long - cap at 1.5 seconds (540 samples)
                rrInterval = Math.floor(this.sampleRate * 1.5);
            }

            // Add the R peak
            pqrstPoints.push({
                index: rPeakIndex,
                amplitude: data[rPeakIndex],
                type: 'R',
                absolutePosition: currentIndex + rPeakIndex
            });

            // ---------- Q WAVE DETECTION ----------
            // Smaller, more conservative window for Q detection
            const qWindowSize = Math.min(Math.floor(rrInterval * 0.08), 18); // Max 18 samples
            const qWindowStart = Math.max(0, rPeakIndex - qWindowSize);
            const qWindowEnd = rPeakIndex;

            let qIndex = qWindowStart;
            let qValue = data[qWindowStart];

            for (let i = qWindowStart; i < qWindowEnd; i++) {
                if (data[i] < qValue) {
                    qValue = data[i];
                    qIndex = i;
                }
            }

            pqrstPoints.push({
                index: qIndex,
                amplitude: qValue,
                type: 'Q',
                absolutePosition: currentIndex + qIndex
            });

            // ---------- P WAVE DETECTION ----------
            // Smaller window for P wave detection
            const pWindowSize = Math.min(Math.floor(rrInterval * 0.15), 27); // Max 27 samples
            const pWindowStart = Math.max(0, qIndex - pWindowSize);
            const pWindowEnd = Math.max(pWindowStart, qIndex - Math.floor(rrInterval * 0.01)); // Small gap

            let pIndex = pWindowStart;
            let pValue = data[pWindowStart];

            for (let i = pWindowStart; i < pWindowEnd; i++) {
                if (data[i] > pValue) {
                    pValue = data[i];
                    pIndex = i;
                }
            }

            pqrstPoints.push({
                index: pIndex,
                amplitude: pValue,
                type: 'P',
                absolutePosition: currentIndex + pIndex
            });

            // ---------- S WAVE DETECTION ----------
            // Smaller window for S wave detection
            const sWindowSize = Math.min(Math.floor(rrInterval * 0.08), 18); // Max 18 samples
            const sWindowStart = rPeakIndex + 1;
            const sWindowEnd = Math.min(data.length - 1, rPeakIndex + sWindowSize);

            let sIndex = sWindowStart;
            let sValue = data[sWindowStart];

            for (let i = sWindowStart; i <= sWindowEnd; i++) {
                if (data[i] < sValue) {
                    sValue = data[i];
                    sIndex = i;
                }
            }

            pqrstPoints.push({
                index: sIndex,
                amplitude: sValue,
                type: 'S',
                absolutePosition: currentIndex + sIndex
            });

            // ---------- T WAVE DETECTION ----------
            // Start T search at least 15% of RR interval after S wave
            const tStartOffset = Math.floor(rrInterval * 0.15); // ~54 samples at 360Hz if RR=360
            const tWindowSize = Math.min(Math.floor(rrInterval * 0.25), 54); // Max 54 samples
            const tWindowStart = sIndex + tStartOffset;
            const tWindowEnd = Math.min(data.length - 1, tWindowStart + tWindowSize);

            let tIndex = tWindowStart;
            let tValue = data[tWindowStart];

            for (let i = tWindowStart; i <= tWindowEnd; i++) {
                if (data[i] > tValue) {
                    tValue = data[i];
                    tIndex = i;
                }
            }

            pqrstPoints.push({
                index: tIndex,
                amplitude: tValue,
                type: 'T',
                absolutePosition: currentIndex + tIndex
            });
        });

        return pqrstPoints;
    }

    // Creates visualization data for all PQRST points
    generateWaveVisualization(data: number[], pqrstPoints: PQRSTPoint[]): {
        pLine: number[];
        qLine: number[];
        rLine: number[];
        sLine: number[];
        tLine: number[];
    } {
        const pLine = new Array(data.length).fill(0);
        const qLine = new Array(data.length).fill(0);
        const rLine = new Array(data.length).fill(0);
        const sLine = new Array(data.length).fill(0);
        const tLine = new Array(data.length).fill(0);

        pqrstPoints.forEach(point => {
            if (point.index >= 0 && point.index < data.length) {
                switch (point.type) {
                    case 'P':
                        pLine[point.index] = point.amplitude;
                        break;
                    case 'Q':
                        qLine[point.index] = point.amplitude;
                        break;
                    case 'R':
                        rLine[point.index] = point.amplitude;
                        break;
                    case 'S':
                        sLine[point.index] = point.amplitude;
                        break;
                    case 'T':
                        tLine[point.index] = point.amplitude;
                        break;
                }
            }
        });

        return { pLine, qLine, rLine, sLine, tLine };
    }

    detectDirectWaves(data: number[], currentIndex: number = 0): PQRSTPoint[] {
        const pqrstPoints: PQRSTPoint[] = [];
        const dataLength = data.length;

        // Calculate signal statistics
        const mean = data.reduce((sum, val) => sum + val, 0) / dataLength;
        const sortedData = [...data].sort((a, b) => b - a);
        const topValues = sortedData.slice(0, Math.floor(dataLength * 0.05));
        const maxValue = topValues[0] || 0;

        // If signal is too weak, don't try to detect anything
        if (maxValue < 0.2) {
            return [];
        }

        // R-peak threshold - use 60% of the maximum value
        const rThreshold = maxValue * 0.6;

        // Step 1: Find R peaks (high positive deflections)
        const rPeaks: number[] = [];

        // Updated window sizes for 360Hz sampling rate
        const peakWindow = Math.floor(this.sampleRate * 0.08); // 80ms window = ~29 samples
        const skipWindow = Math.floor(this.sampleRate * 0.15); // 150ms skip = ~54 samples

        for (let i = peakWindow; i < dataLength - peakWindow; i++) {
            // Skip if not above threshold
            if (data[i] < rThreshold) continue;

            // Check if this is a local maximum within the peak window
            let isPeak = true;
            for (let j = Math.max(0, i - peakWindow); j <= Math.min(dataLength - 1, i + peakWindow); j++) {
                if (j !== i && data[j] > data[i]) {
                    isPeak = false;
                    break;
                }
            }

            if (isPeak) {
                rPeaks.push(i);
                // Skip ahead to avoid detecting the same peak multiple times
                i += skipWindow; // Skip ~150ms ahead for 360Hz
            }
        }

        // If we found R peaks, use them to detect the full PQRST complex
        if (rPeaks.length > 0) {
            // Use our standard PQRST detection with these R peaks
            return this.detectWaves(data, rPeaks, currentIndex);
        }

        return [];
    }

    private isValidQRS(data: number[], rIndex: number): boolean {
        // Updated window sizes for 360Hz sampling rate
        const qrsWindow = Math.floor(this.sampleRate * 0.06); // 60ms = ~22 samples at 360Hz

        // Check if this point has the QRS morphology (Q dip before R, S dip after R)
        // Look for Q wave (negative deflection before R)
        let hasQWave = false;
        for (let i = Math.max(0, rIndex - qrsWindow); i < rIndex; i++) {
            if (data[i] < 0) {
                hasQWave = true;
                break;
            }
        }

        // Look for S wave (negative deflection after R)
        let hasSWave = false;
        for (let i = rIndex + 1; i < Math.min(data.length, rIndex + qrsWindow); i++) {
            if (data[i] < 0) {
                hasSWave = true;
                break;
            }
        }

        // Also check the amplitude of R - it should be significantly positive
        const rAmplitude = data[rIndex];

        // Return true if it has QRS morphology or if the R amplitude is very high
        return (hasQWave && hasSWave) || rAmplitude > 0.5;
    }
}