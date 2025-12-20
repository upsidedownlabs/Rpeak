import { ECGIntervalCalculator } from './ecgIntervals';
import { HRVCalculator } from './hrvCalculator';
import { PQRSTDetector } from './pqrstDetector';
import { PanTompkinsDetector } from './panTompkinsDetector';
import { RecordingSession, PatientInfo } from '../components/SessionRecording';
import { AAMI_CLASSES, zscoreNorm } from './modelTrainer';
import { loadECGModel, loadTensorFlow } from './tfLoader';

export type SessionAnalysisResults = {
    summary: {
        recordingDuration: string;
        recordingDurationSeconds?: number;
        rPeaks?: number[];
        heartRate: {
            average: number;
            median?: number;
            min: number;
            max: number;
            status: string;
        };
        rhythm: {
            classification: string;
            confidence: number;
            irregularBeats: number;
            percentIrregular: number;
        };
    };
    intervals: {
        pr: {
            average: number;
            status: string;
        };
        qrs: {
            average: number;
            status: string;
        };
        qt: {
            average: number;
        };
        qtc: {
            average: number;
            status: string;
        };
        st: {
            deviation: number;
            status: string;
        };
    };
    hrv: {
        timeMetrics: {
            rmssd: number;
            sdnn: number;
            pnn50: number;
            triangularIndex: number;
        };
        frequencyMetrics: {
            lf: number;
            hf: number;
            lfhfRatio: number;
        };
        assessment: {
            status: string;
            description: string;
        };
        physiologicalState: {
            state: string;
            confidence: number;
        };
    };
    aiClassification: {
        prediction: string;
        confidence: number;
        explanation: string;
        beatClassifications?: {
            normal: number;
            supraventricular: number;
            ventricular: number;
            fusion: number;
            other: number;
        };
    };
    abnormalities: {
        type: string;
        severity: 'low' | 'medium' | 'high';
        description: string;
    }[];
    recommendations: string[];
};

export class SessionAnalyzer {
    private panTompkins: PanTompkinsDetector;
    private pqrstDetector: PQRSTDetector;
    private intervalCalculator: ECGIntervalCalculator;
    private hrvCalculator: HRVCalculator;
    private model: any | null = null;
    private sampleRate: number;

    constructor(sampleRate: number) {
        this.sampleRate = sampleRate;
        this.panTompkins = new PanTompkinsDetector(sampleRate);
        this.pqrstDetector = new PQRSTDetector(sampleRate);
        this.intervalCalculator = new ECGIntervalCalculator(sampleRate);
        this.hrvCalculator = new HRVCalculator();
    }

    async loadModel(): Promise<boolean> {
        try {
            this.model = await loadECGModel();
            return true;
        } catch (err) {
            console.error('Failed to load beat-level ECG model:', err);
            this.model = null;
            return false;
        }
    }

    /**
     * Reset internal state between recording sessions to prevent data leakage.
     */
    reset(): void {
        // Reset HRV calculator which accumulates RR intervals
        this.hrvCalculator.reset();
        // Note: Detectors (PanTompkins, PQRST) are stateless, no reset needed
        // intervalCalculator is also stateless
    }

    public async analyzeSession(session: RecordingSession): Promise<SessionAnalysisResults> {
        let intervals = session.intervals;

        if (!intervals) {
            console.warn("No interval data in session");
            if (session.pqrstPoints && session.pqrstPoints.length > 0) {
                const calculator = new ECGIntervalCalculator(session.sampleRate);
                session.intervals = calculator.calculateIntervals(session.pqrstPoints);
            } else {
                session.intervals = {
                    rr: 0,
                    bpm: 0,
                    pr: 0,
                    qrs: 0,
                    qt: 0,
                    qtc: 0,
                    status: {
                        rr: 'unknown',
                        bpm: 'unknown',
                        pr: 'unknown',
                        qrs: 'unknown',
                        qt: 'unknown',
                        qtc: 'unknown'
                    }
                };
            }
            intervals = session.intervals;
        }

        const { ecgData, patientInfo, sampleRate, duration } = session;

        this.intervalCalculator.setGender(patientInfo.gender);

        // 1. Detect R-peaks
        const rPoints = this.pqrstDetector.detectDirectWaves(ecgData).filter(pt => pt.type === 'R');
        const peaks = rPoints.map(pt => pt.index);


        // 2. Detect PQRST waves
        const pqrstPoints = this.pqrstDetector.detectWaves(ecgData, peaks, 0);

        // 3. Calculate ECG intervals
        intervals = session.intervals || this.intervalCalculator.calculateIntervals(pqrstPoints);

        // 4. Calculate HRV metrics
        this.hrvCalculator.extractRRFromPeaks(peaks, sampleRate);
        const hrvMetrics = this.hrvCalculator.getAllMetrics();
        const physioState = this.hrvCalculator.getPhysiologicalState();

        // 5. ST segment analysis is performed in the recording panel; use safe default here
        const stSegmentData = { deviation: 0, status: 'unknown' };

        // 6. Run AI classification using beat-level model
        const aiClassification = await this.runBeatLevelClassification(
            ecgData,
            peaks,
            intervals,
            stSegmentData,
            hrvMetrics,
            patientInfo
        );

        // 7. Determine abnormalities
        const abnormalities = this.detectAbnormalities(
            intervals,
            stSegmentData,
            hrvMetrics,
            aiClassification,
            patientInfo
        );

        // 8. Generate recommendations
        const recommendations = this.generateRecommendations(
            abnormalities,
            aiClassification,
            patientInfo
        );

        // 9. Calculate summary statistics
        const heartRates = this.calculateHeartRateStats(peaks, sampleRate, duration);

        return {
            summary: {
                recordingDuration: this.formatDuration(duration),
                recordingDurationSeconds: duration,
                rPeaks: peaks,
                heartRate: {
                    average: heartRates.average,
                    min: heartRates.min,
                    max: heartRates.max,
                    status: this.determineHeartRateStatus(heartRates.average)
                },
                rhythm: {
                    classification: aiClassification.prediction,
                    confidence: aiClassification.confidence,
                    irregularBeats: this.countIrregularBeats(peaks, sampleRate),
                    percentIrregular: this.calculatePercentIrregular(peaks, sampleRate)
                }
            },
            intervals: {
                pr: {
                    average: intervals?.pr || 0,
                    status: intervals?.status.pr || 'unknown'
                },
                qrs: {
                    average: intervals?.qrs || 0,
                    status: intervals?.status.qrs || 'unknown'
                },
                qt: {
                    average: intervals?.qt || 0
                },
                qtc: {
                    average: intervals?.qtc || 0,
                    status: intervals?.status.qtc || 'unknown'
                },
                st: {
                    deviation: stSegmentData?.deviation || 0,
                    status: stSegmentData?.status || 'unknown'
                }
            },
            hrv: {
                timeMetrics: {
                    rmssd: hrvMetrics.rmssd,
                    sdnn: hrvMetrics.sdnn,
                    pnn50: hrvMetrics.pnn50,
                    triangularIndex: hrvMetrics.triangularIndex
                },
                frequencyMetrics: {
                    lf: hrvMetrics.lfhf.lf,
                    hf: hrvMetrics.lfhf.hf,
                    lfhfRatio: hrvMetrics.lfhf.ratio
                },
                assessment: hrvMetrics.assessment,
                physiologicalState: {
                    state: physioState.state,
                    confidence: physioState.confidence
                }
            },
            aiClassification,
            abnormalities,
            recommendations
        };
    }

    private adaptSignalForModel(ecgWindow: number[]): number[] {
        // Step 1: Use raw normalized signal (no mV conversion, no MIT-BIH scaling)
        const rawSignal = ecgWindow;

        // Step 2: Polarity correction (R-peak should be positive)
        const centerIdx = Math.floor(rawSignal.length / 2);
        const searchRange = 30;
        let maxIdx = centerIdx;
        let maxValue = rawSignal[centerIdx];
        for (let i = Math.max(0, centerIdx - searchRange); i < Math.min(rawSignal.length, centerIdx + searchRange); i++) {
            if (Math.abs(rawSignal[i]) > Math.abs(maxValue)) {
                maxValue = rawSignal[i];
                maxIdx = i;
            }
        }
        const needsFlip = maxValue < 0;
        const polarityCorrectedSignal = needsFlip
            ? rawSignal.map(x => -x)
            : rawSignal;

        // Step 3: Z-score normalization (mean=0, std=1)
        const mean = polarityCorrectedSignal.reduce((a, b) => a + b, 0) / polarityCorrectedSignal.length;
        const std = Math.sqrt(polarityCorrectedSignal.reduce((a, b) => a + (b - mean) ** 2, 0) / polarityCorrectedSignal.length);

        if (std < 0.005) { // Minimum std for normalized data
            return new Array(ecgWindow.length).fill(0);
        }

        const normalizedSignal = polarityCorrectedSignal.map(x => (x - mean) / std);

        return normalizedSignal;
    }

    private async runBeatLevelClassification(
        ecgData: number[],
        peaks: number[],
        intervals: any,
        stSegmentData: any,
        hrvMetrics: any,
        patientInfo: PatientInfo
    ): Promise<{
        prediction: string;
        confidence: number;
        explanation: string;
        beatClassifications?: {
            normal: number;
            supraventricular: number;
            ventricular: number;
            fusion: number;
            other: number;
        };
    }> {
        if (!this.model || !peaks || peaks.length === 0) {
            return {
                prediction: "Analysis Failed",
                confidence: 0,
                explanation: "Could not run AI analysis due to missing model or insufficient data."
            };
        }

        try {
            // Check overall signal quality first (convert to MIT-BIH scale for validation)
            const mitBihLikeData = ecgData.map(x => (x * 400) + 1024);
            const maxAbs = Math.max(...mitBihLikeData.map(x => Math.abs(x - 1024)));
            const variance = mitBihLikeData.reduce((sum, val) => sum + Math.pow(val - 1024, 2), 0) / mitBihLikeData.length;

            // MIT-BIH-style quality thresholds
            if (maxAbs < 50 || variance < 100) {  // 50 units ≈ 244 μV
                return {
                    prediction: "Poor Signal Quality",
                    confidence: 0,
                    explanation: "Signal too weak for reliable AI analysis. Ensure good electrode contact."
                };
            }

            const beatLength = 135; // Updated from 94 to 135 to match modelTrainer.ts
            const halfBeat = Math.floor(beatLength / 2); // 67 samples
            const beatClassifications = {
                normal: 0,
                supraventricular: 0,
                ventricular: 0,
                fusion: 0,
                other: 0
            };

            let totalBeats = 0;
            let validPredictions = 0;
            let confidenceSum = 0;

            // Filter peaks for physiological RR intervals (300-1500ms range)
            const filteredPeaks = peaks.filter((peak, index) => {
                if (index === 0) return true;
                const timeDiff = (peak - peaks[index - 1]) / this.sampleRate * 1000;
                return timeDiff >= 300 && timeDiff <= 1500;
            });

            // Analyze individual beats around R-peaks
            for (const peak of filteredPeaks) {
                const startIdx = peak - halfBeat;
                const endIdx = peak + halfBeat + (beatLength % 2); // For odd beatLength

                // Check bounds
                if (startIdx < 0 || endIdx >= ecgData.length) {
                    continue;
                }

                const rawBeat = ecgData.slice(startIdx, endIdx);
                if (rawBeat.length !== beatLength) {
                    continue;
                }

                // CRITICAL: Apply the same signal adaptation as real-time analysis
                const adaptedBeat = this.adaptSignalForModel(rawBeat);

                // Check if adaptation failed (returns zeros)
                if (adaptedBeat.every(x => x === 0)) {
                    console.log("Session analysis: Beat adaptation failed, skipping");
                    continue;
                }

                // Final z-score normalization of adapted signal
                const mean = adaptedBeat.reduce((a, b) => a + b, 0) / adaptedBeat.length;
                const std = Math.sqrt(adaptedBeat.reduce((a, b) => a + (b - mean) ** 2, 0) / adaptedBeat.length);

                if (std <= 0.005) {  // Relaxed threshold for consumer devices
                    console.log("Session analysis: Adapted beat too flat, skipping");
                    continue;
                }

                const normalizedBeat = adaptedBeat.map(x => (x - mean) / std);

                // Validate normalization
                const normMean = normalizedBeat.reduce((a, b) => a + b, 0) / normalizedBeat.length;
                if (Math.abs(normMean) > 0.3) {  // Relaxed threshold
                    console.log("Session analysis: Beat normalization failed, skipping");
                    continue;
                }

                // Dynamically load TensorFlow for tensor operations
                const tf = await loadTensorFlow();
                if (!tf) {
                    console.error('TensorFlow.js not loaded');
                    continue;
                }

                // Create input tensor for the model - shape [1, 135, 1]
                const inputTensor = tf.tensor3d([normalizedBeat.map(v => [v])], [1, beatLength, 1]);

                try {
                    const outputTensor = this.model.predict(inputTensor) as any;
                    const probabilities = await outputTensor.data();

                    const predArray = Array.from(probabilities) as number[];

                    // Apply the same bias correction as real-time analysis
                    const deviceBiasCorrection = [
                        1.4,  // Normal: moderate boost
                        0.9,  // Supraventricular: mild reduction
                        1.0,  // Ventricular: no change
                        0.8,  // Fusion: mild reduction
                        0.7   // Other: mild reduction
                    ];

                    const correctedProbs = predArray.map((prob, idx) => (prob as number) * deviceBiasCorrection[idx]);
                    const correctedSum = correctedProbs.reduce((a, b) => a + b, 0);
                    const normalizedProbs = correctedProbs.map(p => p / correctedSum);

                    const maxIndex = normalizedProbs.indexOf(Math.max(...normalizedProbs));
                    const confidence = normalizedProbs[maxIndex];

                    // Only accept predictions with reasonable confidence
                    if (maxIndex >= 0 && maxIndex < AAMI_CLASSES.length && confidence > 0.4) {  // Lowered from 0.5 to 0.4
                        const predictedClass = AAMI_CLASSES[maxIndex].toLowerCase();

                        // Count beat classifications
                        switch (predictedClass) {
                            case 'normal':
                                beatClassifications.normal++;
                                break;
                            case 'supraventricular':
                                beatClassifications.supraventricular++;
                                break;
                            case 'ventricular':
                                beatClassifications.ventricular++;
                                break;
                            case 'fusion':
                                beatClassifications.fusion++;
                                break;
                            case 'other':
                                beatClassifications.other++;
                                break;
                        }
                        validPredictions++;
                        confidenceSum += confidence;

                    }

                    outputTensor.dispose();
                } catch (err) {
                    console.warn('Session analysis: Failed to predict beat:', err);
                }

                inputTensor.dispose();
                totalBeats++;
            }


            // Determine overall rhythm classification based on beat analysis
            let overallPrediction = "Insufficient Data";
            let overallConfidence = 0;

            if (validPredictions >= 3) {  // Require at least 3 valid beats for analysis
                const totalValidBeats = Object.values(beatClassifications).reduce((sum, count) => sum + count, 0);

                // Calculate percentages
                const normalPercent = (beatClassifications.normal / totalValidBeats) * 100;
                const ventricularPercent = (beatClassifications.ventricular / totalValidBeats) * 100;
                const supraventricularPercent = (beatClassifications.supraventricular / totalValidBeats) * 100;
                const fusionPercent = (beatClassifications.fusion / totalValidBeats) * 100;
                const otherPercent = (beatClassifications.other / totalValidBeats) * 100;

                const avgConfidence = confidenceSum / validPredictions;

                // Determine overall classification
                if (normalPercent >= 75) {  // Lowered from 80% to 75%
                    overallPrediction = "Normal Sinus Rhythm";
                    overallConfidence = avgConfidence * 100;
                } else if (ventricularPercent > 15) {  // Increased sensitivity
                    overallPrediction = "Ventricular Arrhythmia";
                    overallConfidence = Math.min(avgConfidence * 100, 85); // Cap at 85%
                } else if (supraventricularPercent > 15) {
                    overallPrediction = "Supraventricular Arrhythmia";
                    overallConfidence = Math.min(avgConfidence * 100, 80);
                } else if (fusionPercent > 10) {  // Increased sensitivity
                    overallPrediction = "Fusion Beats Detected";
                    overallConfidence = Math.min(avgConfidence * 100, 75);
                } else if (otherPercent > 20) {  // Increased threshold
                    overallPrediction = "Abnormal Rhythm";
                    overallConfidence = Math.min(avgConfidence * 100, 70);
                } else {
                    // Mixed rhythm
                    overallPrediction = "Mixed Rhythm Pattern";
                    overallConfidence = Math.min(avgConfidence * 100, 65);
                }

                // Additional checks based on HRV and intervals
                if (intervals) {
                    if (intervals.status.bpm === 'bradycardia') {
                        overallPrediction = "Bradycardia";
                        overallConfidence = Math.max(overallConfidence, 70);
                    } else if (intervals.status.bpm === 'tachycardia') {
                        overallPrediction = "Tachycardia";
                        overallConfidence = Math.max(overallConfidence, 70);
                    }
                }

            }

            return {
                prediction: overallPrediction,
                confidence: overallConfidence,
                explanation: this.getExplanationForClassification(overallPrediction, beatClassifications, validPredictions),
                beatClassifications: beatClassifications
            };

        } catch (err) {
            console.error('Session beat-level classification failed:', err);
            return {
                prediction: "Analysis Error",
                confidence: 0,
                explanation: "An error occurred during session beat-level analysis. Please try again."
            };
        }
    }

    // Update the explanation method to include beat count information
    private getExplanationForClassification(
        prediction: string,
        beatClassifications: {
            normal: number;
            supraventricular: number;
            ventricular: number;
            fusion: number;
            other: number;
        },
        validPredictions: number
    ): string {
        const total = Object.values(beatClassifications).reduce((sum, count) => sum + count, 0);

        if (total === 0) {
            return "Insufficient quality data for reliable AI analysis. Signal may be too noisy or weak.";
        }

        if (validPredictions < 3) {
            return `Only ${validPredictions} beats could be analyzed reliably. Longer recording recommended for comprehensive analysis.`;
        }

        const explanations: { [key: string]: string } = {
            "Normal Sinus Rhythm": `Analysis of ${total} beats shows predominantly normal cardiac rhythm (${((beatClassifications.normal / total) * 100).toFixed(1)}% normal beats). Signal quality and beat morphology appear consistent with healthy sinus rhythm.`,

            "Ventricular Arrhythmia": `Detected ${beatClassifications.ventricular} ventricular beats out of ${total} analyzed beats (${((beatClassifications.ventricular / total) * 100).toFixed(1)}%). This may indicate premature ventricular contractions (PVCs) or ventricular tachycardia.`,

            "Supraventricular Arrhythmia": `Found ${beatClassifications.supraventricular} supraventricular beats out of ${total} analyzed beats (${((beatClassifications.supraventricular / total) * 100).toFixed(1)}%). This suggests arrhythmias originating above the ventricles.`,

            "Fusion Beats Detected": `Identified ${beatClassifications.fusion} fusion beats out of ${total} analyzed beats. Fusion beats occur when multiple electrical impulses activate the heart simultaneously.`,

            "Abnormal Rhythm": `Analysis detected irregular patterns in ${((beatClassifications.other / total) * 100).toFixed(1)}% of ${total} beats. The rhythm shows characteristics that don't fit typical arrhythmia categories.`,

            "Mixed Rhythm Pattern": `Complex rhythm pattern detected with multiple beat types: Normal (${beatClassifications.normal}), Ventricular (${beatClassifications.ventricular}), Supraventricular (${beatClassifications.supraventricular}), Other (${beatClassifications.other}). This suggests a mixed arrhythmia.`,

            "Bradycardia": `Slow heart rate detected in addition to beat morphology analysis. ${total} beats were analyzed for rhythm classification.`,

            "Tachycardia": `Elevated heart rate detected along with beat pattern analysis of ${total} beats.`,

            "Insufficient Data": `Only ${validPredictions} beats met quality standards for AI analysis. A longer recording with better signal quality is recommended.`,

            "Analysis Error": "Technical error occurred during analysis. Please ensure good electrode contact and try recording again."
        };

        return explanations[prediction] ||
            `AI analysis completed on ${total} beats using MIT-BIH compatible signal processing. The model detected patterns requiring clinical correlation.`;
    }

    private detectAbnormalities(
        intervals: any,
        stSegmentData: any,
        hrvMetrics: any,
        aiClassification: any,
        patientInfo: PatientInfo
    ): { type: string; severity: 'low' | 'medium' | 'high'; description: string }[] {
        const abnormalities: { type: string; severity: 'low' | 'medium' | 'high'; description: string }[] = [];

        if (intervals) {
            if (intervals.status.bpm === 'bradycardia') {
                abnormalities.push({
                    type: 'Bradycardia',
                    severity: 'medium',
                    description: 'Slow heart rate detected, which may indicate an underlying condition.'
                });
            }

            if (intervals.status.bpm === 'tachycardia') {
                abnormalities.push({
                    type: 'Tachycardia',
                    severity: 'medium',
                    description: 'Elevated heart rate detected, which could be due to exertion, stress, or cardiac issues.'
                });
            }

            if (intervals.status.pr === 'long') {
                abnormalities.push({
                    type: 'Prolonged PR Interval',
                    severity: 'medium',
                    description: 'Delayed conduction from atria to ventricles detected.'
                });
            }

            if (intervals.status.qrs === 'wide') {
                abnormalities.push({
                    type: 'Wide QRS Complex',
                    severity: 'medium',
                    description: 'Delayed ventricular conduction detected, possibly indicating bundle branch block.'
                });
            }

            if (intervals.status.qtc === 'prolonged') {
                abnormalities.push({
                    type: 'Prolonged QTc',
                    severity: 'high',
                    description: 'Prolonged QTc interval increases risk of dangerous arrhythmias.'
                });
            }
        }

        // Check for ventricular arrhythmias based on beat classification
        if (aiClassification.beatClassifications && aiClassification.beatClassifications.ventricular > 0) {
            const totalBeats = (Object.values(aiClassification.beatClassifications) as number[]).reduce((sum, count) => sum + count, 0);
            const ventricularPercent = (aiClassification.beatClassifications.ventricular / totalBeats) * 100;

            if (ventricularPercent > 10) {
                abnormalities.push({
                    type: 'Ventricular Arrhythmia',
                    severity: 'high',
                    description: `${ventricularPercent.toFixed(1)}% of beats classified as ventricular, indicating possible PVCs or VT.`
                });
            }
        }

        // Check ST segment
        if (stSegmentData) {
            if (stSegmentData.status === 'elevation') {
                abnormalities.push({
                    type: 'ST Elevation',
                    severity: 'high',
                    description: 'ST segment elevation detected, which may indicate myocardial injury.'
                });
            } else if (stSegmentData.status === 'depression') {
                abnormalities.push({
                    type: 'ST Depression',
                    severity: 'medium',
                    description: 'ST segment depression detected, which may indicate ischemia.'
                });
            }
        }

        return abnormalities;
    }

    private generateRecommendations(
        abnormalities: { type: string; severity: 'low' | 'medium' | 'high'; description: string }[],
        aiClassification: {
            prediction: string;
            confidence: number;
            explanation: string;
            beatClassifications?: {
                normal: number;
                supraventricular: number;
                ventricular: number;
                fusion: number;
                other: number;
            };
        },
        patientInfo: PatientInfo
    ): string[] {
        const recommendations: string[] = [];

        recommendations.push(
            "Remember that this device is not a medical diagnostic tool. Always consult with a healthcare professional."
        );

        if (abnormalities.length > 0 || aiClassification.prediction !== "Normal Sinus Rhythm") {
            recommendations.push(
                "Based on the patterns detected, consider scheduling a consultation with a cardiologist."
            );
        }

        // Specific recommendations based on beat classifications
        if (aiClassification.beatClassifications) {
            const total = Object.values(aiClassification.beatClassifications).reduce((sum, count) => sum + count, 0);
            const ventricularPercent = (aiClassification.beatClassifications.ventricular / total) * 100;

            if (ventricularPercent > 10) {
                recommendations.push(
                    "Frequent ventricular beats detected. Avoid excessive caffeine and monitor for symptoms like palpitations."
                );
            }
        }

        if (abnormalities.some(abn => abn.severity === 'high')) {
            recommendations.push(
                "High-priority abnormalities detected. Seek immediate medical attention if experiencing symptoms."
            );
        }

        return recommendations;
    }

    private calculateHeartRateStats(peaks: number[], sampleRate: number, duration: number): {
        average: number;
        min: number;
        max: number;
        median: number;
    } {
        if (!peaks || peaks.length < 2) {
            console.warn("No valid R-peaks detected.");
            return { average: 0, min: 0, max: 0, median: 0 };
        }

        const rrIntervals = [];
        for (let i = 1; i < peaks.length; i++) {
            const rr = (peaks[i] - peaks[i - 1]) * (1000 / sampleRate);
            rrIntervals.push(rr);
        }

        // Filter RR intervals to physiological range (300ms to 2000ms)
        const filteredRRs = rrIntervals.filter(rr => rr >= 300 && rr <= 2000);

        if (filteredRRs.length === 0) {
            return { average: 0, min: 0, max: 0, median: 0 };
        }

        // Calculate BPM for each RR interval
        const bpms = filteredRRs.map(rr => 60000 / rr);

        // Mean, median, min, max BPM
        const average = bpms.reduce((a, b) => a + b, 0) / bpms.length;
        const sortedBPM = bpms.slice().sort((a, b) => a - b);
        const median = sortedBPM[Math.floor(sortedBPM.length / 2)];
        const min = Math.min(...bpms);
        const max = Math.max(...bpms);

        return {
            average: isNaN(average) ? 0 : average,
            min: isNaN(min) ? 0 : min,
            max: isNaN(max) ? 0 : max,
            median: isNaN(median) ? 0 : median
        };
    }

    private countIrregularBeats(peaks: number[], sampleRate: number): number {
        if (!peaks || peaks.length < 3) return 0;
        const rrIntervals = [];
        for (let i = 1; i < peaks.length; i++) {
            rrIntervals.push((peaks[i] - peaks[i - 1]) * (1000 / sampleRate));
        }
        const median = rrIntervals.sort((a, b) => a - b)[Math.floor(rrIntervals.length / 2)];
        return rrIntervals.filter(rr => Math.abs(rr - median) > median * 0.2).length;
    }

    private calculatePercentIrregular(peaks: number[], sampleRate: number): number {
        if (!peaks || peaks.length < 3) return 0;
        const totalIntervals = peaks.length - 1;
        const irregularCount = this.countIrregularBeats(peaks, sampleRate);
        return (irregularCount / totalIntervals) * 100;
    }

    private formatDuration(seconds: number): string {
        const min = Math.floor(seconds / 60);
        const sec = Math.floor(seconds % 60);
        return `${min}:${sec.toString().padStart(2, '0')}`;
    }

    private determineHeartRateStatus(bpm: number): string {
        if (isNaN(bpm) || bpm <= 0) return 'unknown';
        if (bpm < 60) return 'bradycardia';
        if (bpm > 100) return 'tachycardia';
        return 'normal';
    }
}