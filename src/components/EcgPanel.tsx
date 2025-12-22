"use client";
import React, { useEffect, useRef, useState } from "react";
import { Bluetooth, Activity, Zap, TrendingUp, Play, Square, Clock } from "lucide-react";
import { WebglPlot, WebglLine, ColorRGBA } from "webgl-plot";
import { HighpassFilter, NotchFilter, LowpassFilter } from "../lib/filters";
import { HRVCalculator } from '../lib/hrvCalculator';
import { PQRSTDetector, PQRSTPoint } from '../lib/pqrstDetector';
import { detectRPeaksECG } from '../lib/rPeakDetector';
import { ECGIntervalCalculator, ECGIntervals } from '../lib/ecgIntervals';
import { loadECGModel } from '../lib/tfLoader';
import SessionRecording, { PatientInfo, RecordingSession } from './SessionRecording';
import { SessionAnalyzer, SessionAnalysisResults } from '../lib/sessionAnalyzer';
import SessionReport from './SessionReport';
import { AAMI_CLASSES } from "../lib/modelTrainer";

const SERVICE_UUID = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
const DATA_CHAR_UUID = "beb5483e-36e1-4688-b7f5-ea07361b26a8";
const CONTROL_CHAR_UUID = "0000ff01-0000-1000-8000-00805f9b34fb";

const NUM_POINTS = 1000; // ~2.78s window at 360Hz
const SAMPLE_RATE = 360; // 360Hz sampling rate
const MODEL_INPUT_LENGTH = 135; // 135 samples ≈ 375ms at 360Hz
const SINGLE_SAMPLE_LEN = 7;
const NEW_PACKET_LEN = 7 * 10;

export default function EcgFullPanel() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [connected, setConnected] = useState(false);
    const [startTime, setStartTime] = useState<number | null>(null);
    const [bpmDisplay, setBpmDisplay] = useState("-- BPM");
    const [showHRV, setShowHRV] = useState(false);
    const [classLabels, setClassLabels] = useState<string[]>(AAMI_CLASSES);
    const [showPQRST, setShowPQRST] = useState(false);
    const [showIntervals, setShowIntervals] = useState(false);
    const [signalQuality, setSignalQuality] = useState<'good' | 'poor' | 'no-signal'>('no-signal');

    // Recording state
    const [isRecording, setIsRecording] = useState(false);
    const [recordingTime, setRecordingTime] = useState("00:00");
    const [recordedData, setRecordedData] = useState<number[]>([]);
    const [currentSession, setCurrentSession] = useState<RecordingSession | null>(null);
    const [sessionResults, setSessionResults] = useState<SessionAnalysisResults | null>(null);
    const [showSessionReport, setShowSessionReport] = useState(false);
    const sessionAnalyzer = useRef(new SessionAnalyzer(SAMPLE_RATE));
    // Patient info modal state
    const [showPatientInfo, setShowPatientInfo] = useState(false);

    const RPEAK_BUFFER_SIZE = 10; // Recent R-peaks used for BPM
    // Physiological state estimate
    const [physioState, setPhysioState] = useState<{ state: string; confidence: number }>({
        state: "Analyzing",
        confidence: 0
    });

    const [hrvMetrics, setHrvMetrics] = useState<HRVMetrics | null>(null);
    const [ecgIntervals, setEcgIntervals] = useState<ECGIntervals | null>(null);
    const [gender, setGender] = useState<'male' | 'female'>('male');

    const [modelLoaded, setModelLoaded] = useState(false);
    const [modelLoading, setModelLoading] = useState(false);
    const [ecgModel, setEcgModel] = useState<any | null>(null);
    const [modelPrediction, setModelPrediction] = useState<{
        prediction: string;
        confidence: number;
    } | null>(null);

    // Auto Analyze state and toggle function

    const wglpRef = useRef<WebglPlot | null>(null);
    const lineRef = useRef<WebglLine | null>(null);
    const dataCh0 = useRef(new Array(NUM_POINTS).fill(0));
    const absoluteSampleIndexBuffer = useRef<number[]>(new Array(NUM_POINTS).fill(0));
    const sampleIndex = useRef(0);
    const totalSamples = useRef(0);
    const highpass = useRef(new HighpassFilter()); // Updated filter for 360Hz
    const notch = useRef(new NotchFilter()); // Updated filter for 360Hz
    const ecg = useRef(new LowpassFilter()); // Updated filter for 360Hz
    const hrvCalculator = useRef(new HRVCalculator());
    const pqrstDetector = useRef(new PQRSTDetector(SAMPLE_RATE));
    const pqrstPoints = useRef<PQRSTPoint[]>([]);
    const pLineRef = useRef<WebglLine | null>(null);
    const qLineRef = useRef<WebglLine | null>(null);
    const rLineRef = useRef<WebglLine | null>(null);
    const sLineRef = useRef<WebglLine | null>(null);
    const tLineRef = useRef<WebglLine | null>(null);
    const intervalCalculator = useRef(new ECGIntervalCalculator(SAMPLE_RATE));
    // Currently visible PQRST points
    const [visiblePQRST, setVisiblePQRST] = useState<PQRSTPoint[]>([]);
    // ST segment analysis state
    const [stSegmentData, setSTSegmentData] = useState<STSegmentData | null>(null);
    const [showAIAnalysis, setShowAIAnalysis] = useState(false); // Controls AI Analysis panel visibility
    // Minimum std threshold for a valid beat (empirical for consumer devices)
    const FLAT_SIGNAL_STD_THRESHOLD = 0.005;
    const recordBufferRef = useRef<number[]>([]);
    const recordedDataRef = useRef<number[]>([]);
    const isRecordingRef = useRef<boolean>(false);
    const [rPeakTimestamps, setRPeakTimestamps] = useState<number[]>([]);
    const lastAcceptedSampleRef = useRef<number | null>(null);
    const lastPQRSTStrRef = useRef<string>("");
    const recordingStartRef = useRef<number | null>(null);
    const REFRACTORY_MS = 300; // Minimum RR gap to avoid duplicate counts (ms)
    // BPM smoothing and display cadence
    const BPM_SMOOTHING_ALPHA = 0.1; // Lower = more stable
    const BPM_UPDATE_INTERVAL_MS = 1000; // Update display at 1 Hz
    const lastBpmUpdateRef = useRef(0);
    const smoothedBpmRef = useRef(0); // Track smoothed BPM without causing re-renders

    type HRVMetrics = {
        sampleCount: number;
        assessment: {
            color: string;
            status: string;
            description: string;
        };
        rmssd: number;
        sdnn: number;
        pnn50: number;
        triangularIndex: number;
        lfhf: {
            lf: number;
            hf: number;
            ratio: number;
        };

    };

    // Add this type definition with your other types
    type STSegmentData = {
        deviation: number;
        status: 'normal' | 'elevation' | 'depression';
    };

    // Gate processing to active modes to save resources
    const appActive = connected || isRecording || showAIAnalysis || showHRV || showPQRST;

    useEffect(() => {
        if (typeof window !== "undefined") {
            const labels = JSON.parse(localStorage.getItem('ecg-class-labels') || 'null');
            setClassLabels(Array.isArray(labels) && labels.length > 0 ? labels : AAMI_CLASSES);
        }
    }, []);

    // Keep a ref in sync with recording state for BLE handler closure
    useEffect(() => {
        isRecordingRef.current = isRecording;
    }, [isRecording]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        // Defer WebGL init to reduce initial load
        const initWebGL = () => {
            const dpr = window.devicePixelRatio || 1;
            canvas.width = canvas.clientWidth * dpr;
            canvas.height = canvas.clientHeight * dpr;

            const wglp = new WebglPlot(canvas);

            // ECG line (main signal)
            const line = new WebglLine(new ColorRGBA(0, 1, 0.2, 1), NUM_POINTS);
            line.arrangeX();

            // PQRST overlay lines
            const pLine = new WebglLine(new ColorRGBA(1, 0.7, 0, 1), NUM_POINTS); // Orange for P
            pLine.arrangeX();

            const qLine = new WebglLine(new ColorRGBA(0.2, 0.6, 1, 1), NUM_POINTS); // Blue for Q
            qLine.arrangeX();

            const rLine = new WebglLine(new ColorRGBA(1, 0, 0, 1), NUM_POINTS); // Red for R
            rLine.arrangeX();

            const sLine = new WebglLine(new ColorRGBA(0, 0.8, 1, 1), NUM_POINTS); // Cyan for S
            sLine.arrangeX();

            const tLine = new WebglLine(new ColorRGBA(0.8, 0.3, 1, 1), NUM_POINTS); // Purple for T
            tLine.arrangeX();

            // Add all lines to the plot
            wglp.addLine(line);
            wglp.addLine(pLine);
            wglp.addLine(qLine);
            wglp.addLine(rLine);
            wglp.addLine(sLine);
            wglp.addLine(tLine);

            // Store references
            wglpRef.current = wglp;
            lineRef.current = line;
            pLineRef.current = pLine;
            qLineRef.current = qLine;
            rLineRef.current = rLine;
            sLineRef.current = sLine;
            tLineRef.current = tLine;

            const render = () => {
                requestAnimationFrame(render);

                // Skip redraw when idle (saves CPU/GPU)
                if (!connected && totalSamples.current === 0) return;

                const scale = getScaleFactor();
                for (let i = 0; i < NUM_POINTS; i++) {
                    line.setY(i, dataCh0.current[i] * scale);

                    // Update PQRST lines if visible
                    if (showPQRST) {
                        pLine.setY(i, pLineRef.current?.getY(i) || 0);
                        qLine.setY(i, qLineRef.current?.getY(i) || 0);
                        rLine.setY(i, rLineRef.current?.getY(i) || 0);
                        sLine.setY(i, sLineRef.current?.getY(i) || 0);
                        tLine.setY(i, tLineRef.current?.getY(i) || 0);
                    }
                }
                wglp.update();
            };
            render();
        };

        // Use requestIdleCallback to defer WebGL init until browser is idle
        const idleCallbackId = requestIdleCallback(initWebGL, { timeout: 2000 });

        return () => cancelIdleCallback(idleCallbackId);
    }, [showPQRST]);

    function getScaleFactor() {
        // Return cached scale factor
        return scaleFactorRef.current;
    }

    const scaleFactorRef = useRef(1);

    useEffect(() => {
        if (!appActive) return; // Don't run when idle

        const scaleInterval = setInterval(() => {
            // Periodically update scale factor without blocking renders
            const maxAbs = Math.max(...dataCh0.current.map(Math.abs), 0.1);
            let scale = maxAbs > 0.9 ? 0.9 / maxAbs : 1;
            scale = Math.max(0.5, Math.min(scale, 1));
            scaleFactorRef.current = scale;
        }, 100);

        return () => clearInterval(scaleInterval);
    }, [appActive]);

    function updatePeaks() {
        // Compute signal statistics
        const maxAbs = Math.max(...dataCh0.current.map(Math.abs));
        const mean = dataCh0.current.reduce((sum, val) => sum + val, 0) / dataCh0.current.length;
        const variance = dataCh0.current.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / dataCh0.current.length;

        // Skip peak detection if the signal is too weak or too flat
        if (maxAbs < 0.05 || variance < 0.0002) {
            pqrstPoints.current = [];
            if (showPQRST) {
                setVisiblePQRST([]);
            }
            return;
        }

        const peaks = detectRPeaksECG(dataCh0.current, SAMPLE_RATE, { adaptiveThreshold: true });

        // Detect PQRST waves
        let pqrstDetected = false;

        if (peaks.length >= 1) {
            // Detect waves using peak indices
            pqrstPoints.current = pqrstDetector.current.detectWaves(dataCh0.current, peaks);
            pqrstDetected = pqrstPoints.current.length > 0;

            if (showPQRST) {
                debouncedSetVisiblePQRST([...pqrstPoints.current]);
            }
        }

        // Fallback: direct detection when peak-based fails
        if (!pqrstDetected) {

            pqrstPoints.current = pqrstDetector.current.detectDirectWaves(dataCh0.current, sampleIndex.current);

            if (showPQRST && pqrstPoints.current.length > 0) {
                setVisiblePQRST([...pqrstPoints.current]);
            } else {
                setVisiblePQRST([]);
            }
        }

        if (peaks.length >= 2) {
            hrvCalculator.current.extractRRFromPeaks(peaks, SAMPLE_RATE);
            const metrics = hrvCalculator.current.getAllMetrics();
            setHrvMetrics(prev => {
                // Compare by sampleCount to avoid deep equality checks
                if (!prev || prev.sampleCount !== metrics.sampleCount) {
                    return metrics;
                }
                return prev;
            });
        } else {
            setHrvMetrics(null);
        }

        // Process R-peaks for BPM calculation before early return
        const absolutePeaks = peaks
            .map(idx => absoluteSampleIndexBuffer.current[idx])
            .filter(idx => Number.isFinite(idx));

        // Now call handleNewRPeak for each detected absolute R-peak
        absolutePeaks.forEach(idx => handleNewRPeak(idx));

        // Calculate ECG intervals when PQRST points are available
        if (pqrstPoints.current.length > 0) {
            const intervals = intervalCalculator.current.calculateIntervals(pqrstPoints.current);
            if (intervals) {
                // ST segment analysis
                const stAnalysis = analyzeSTSegment(pqrstPoints.current);
                if (stAnalysis) {
                    setSTSegmentData(stAnalysis);
                }
                setEcgIntervals(intervals);
                return; // Only return if intervals are set
            }
        }


    }
    useEffect(() => {
        if (hrvMetrics && hrvMetrics.sampleCount >= 30) {
            const stateObj = hrvCalculator.current.getPhysiologicalState();
            setPhysioState(stateObj);
        } else {
            setPhysioState({ state: "Analyzing", confidence: 0 });
        }
    }, [hrvMetrics]);


    // Only clear visiblePQRST when hiding PQRST
    useEffect(() => {
        if (!showPQRST) {
            setVisiblePQRST([]);
        }
    }, [showPQRST]);


    // Toggle PQRST line visibility without clearing their data
    useEffect(() => {
        const pqrstLines = [
            pLineRef.current,
            qLineRef.current,
            rLineRef.current,
            sLineRef.current,
            tLineRef.current
        ];
        pqrstLines.forEach(line => {
            if (!line) return;
            line.color.a = showPQRST ? 1 : 0;
        });
    }, [showPQRST]);

    // Call this for each detected R-peak (absoluteSampleIndex = absolute sample count when captured)
    const handleNewRPeak = React.useCallback((absoluteSampleIndex: number) => {
        const timeMs = (absoluteSampleIndex / SAMPLE_RATE) * 1000;

        // Refractory in samples to avoid duplicate counts from the sliding buffer
        const MIN_PEAK_SAMPLES = Math.floor((REFRACTORY_MS / 1000) * SAMPLE_RATE);
        const lastSample = lastAcceptedSampleRef.current;
        if (lastSample !== null && absoluteSampleIndex - lastSample < MIN_PEAK_SAMPLES) {
            return;
        }
        lastAcceptedSampleRef.current = absoluteSampleIndex;

        setRPeakTimestamps(prev => {
            const merged = [...prev, timeMs];
            const result = merged.slice(-RPEAK_BUFFER_SIZE);
            return result;
        });
    }, [RPEAK_BUFFER_SIZE]);

    // --- In your peak detection logic, call handleNewRPeak(idx) for each detected R-peak ---

    // --- BPM calculation effect ---
    const [smoothedBpm, setSmoothedBpm] = useState<number>(0);

    useEffect(() => {
        // Freeze updates when signal quality is poor
        if (signalQuality === 'poor') {
            return;
        }

        // If no signal, show placeholder but do not jitter
        if (signalQuality === 'no-signal') {
            setBpmDisplay("-- BPM");
            return;
        }

        // Require at least two beats to compute RR
        if (rPeakTimestamps.length < 2) {
            return;
        }

        // Rate-limit visual updates to 1 Hz
        const now = performance.now();
        if (now - lastBpmUpdateRef.current < BPM_UPDATE_INTERVAL_MS) {
            return;
        }
        lastBpmUpdateRef.current = now;

        // Build RR intervals with physiologic bounds
        const rrIntervals: number[] = [];
        for (let i = 1; i < rPeakTimestamps.length; i++) {
            const rr = rPeakTimestamps[i] - rPeakTimestamps[i - 1];
            if (rr >= 300 && rr <= 1500) rrIntervals.push(rr);
        }

        if (rrIntervals.length === 0) {
            return;
        }

        // Trim outliers lightly when enough samples
        const sorted = [...rrIntervals].sort((a, b) => a - b);
        const trim = sorted.length >= 8 ? Math.floor(sorted.length * 0.1) : 0; // window ~8–12
        const trimmed = trim > 0 ? sorted.slice(trim, sorted.length - trim) : sorted;
        const avgRR = trimmed.reduce((s, v) => s + v, 0) / trimmed.length;
        const instantBpm = 60000 / avgRR;

        // Exponential smoothing for clinical-grade stability
        const prev = smoothedBpmRef.current;
        const next = prev === 0
            ? instantBpm
            : prev + BPM_SMOOTHING_ALPHA * (instantBpm - prev);

        smoothedBpmRef.current = next;
        setSmoothedBpm(next);
        setBpmDisplay(`${Math.round(next)} BPM`);
    }, [rPeakTimestamps, signalQuality]);

    useEffect(() => {
        if (!appActive) return; // CRITICAL: Don't run when idle

        // Peak detection update (faster for PQRST responsiveness)
        const peakInterval = setInterval(() => {
            if (connected) {
                updatePeaks();
            }
        }, 200); // 200ms = 5 times per second (balanced between performance and responsiveness)

        return () => {
            clearInterval(peakInterval);
        };
    }, [appActive, connected]);

    // Add effect to set gender
    useEffect(() => {
        intervalCalculator.current.setGender(gender);
    }, [gender]);

    // Explicit function to ensure model is loaded
    const ensureModelLoaded = async () => {
        if (ecgModel || modelLoaded) return;
        if (modelLoading) return;

        setModelLoading(true);
        try {
            const model = await loadECGModel();
            setEcgModel(model);
            setModelLoaded(true);

        } catch (err) {

            setModelLoaded(false);
            setEcgModel(null);
        } finally {
            setModelLoading(false);
        }
    };

    // Handle AI button click with explicit model load
    const handleAIClick = async () => {
        await ensureModelLoaded();
        setShowAIAnalysis(prev => !prev);
    };

    async function connect() {
        try {
            // Check if navigator.bluetooth is available
            if (!('bluetooth' in navigator)) {
                alert("Web Bluetooth API is not supported in this browser.");
                return;
            }
            const device = await (navigator as any).bluetooth.requestDevice({
                filters: [{ namePrefix: "NPG" }],
                optionalServices: [SERVICE_UUID]
            });
            const server = await device.gatt?.connect();
            const service = await server?.getPrimaryService(SERVICE_UUID);
            const controlChar = await service?.getCharacteristic(CONTROL_CHAR_UUID);
            const dataChar = await service?.getCharacteristic(DATA_CHAR_UUID);

            await controlChar?.writeValue(new TextEncoder().encode("START"));
            await dataChar?.startNotifications();

            dataChar?.addEventListener("characteristicvaluechanged", (event: any) => {
                const value = event.target.value;
                if (value.byteLength === NEW_PACKET_LEN) {
                    for (let i = 0; i < NEW_PACKET_LEN; i += SINGLE_SAMPLE_LEN) {
                        const view = new DataView(value.buffer.slice(i, i + SINGLE_SAMPLE_LEN));
                        const raw = view.getInt16(1, false);
                        const norm = (raw - 2048) / 2048;

                        // Apply high-pass, then notch, then bandpass
                        let filtered = highpass.current.process(norm);
                        filtered = notch.current.process(filtered);
                        filtered = ecg.current.process(filtered);

                        if (!isFinite(filtered) || isNaN(filtered)) filtered = 0;
                        filtered = Math.max(-1, Math.min(1, filtered));

                        // Store and use filtered value
                        const absoluteIndex = totalSamples.current;
                        dataCh0.current[sampleIndex.current] = filtered;
                        absoluteSampleIndexBuffer.current[sampleIndex.current] = absoluteIndex;
                        sampleIndex.current = (sampleIndex.current + 1) % NUM_POINTS;
                        totalSamples.current += 1;

                        // If recording, buffer filtered samples for session save
                        if (isRecordingRef.current) {
                            recordBufferRef.current.push(filtered);
                        }
                    }

                    // Peak updates are driven by the periodic interval
                }
            });

            setConnected(true);
            setStartTime(Date.now());
            hrvCalculator.current.reset();
            intervalCalculator.current.reset(); // Reset interval calculator

        } catch (e) {
            console.error("BLE Connection failed:", e);
        }
    }

    // Utility: Convert normalized value (-1 to +1) to millivolts (mV)
    function normalizedToMillivolts(normValue: number, vref = 3.1, adcMax = 4095, gain = 1650): number {
        // Reconstruct raw ADC from normalized input
        const adcValue = Math.round(normValue * 2048 + 2048);
        // ADC volts:
        const volts = (adcValue / adcMax) * vref;
        // Convert to mV and divide by amplifier gain to get electrode mV
        return (volts * 1000) / gain;
    }

    // Adapt signal for model
    const adaptSignalForModel = (ecgWindow: number[]): number[] => {
        // Step 1: Convert normalized signal to mV
        const mVSignal = ecgWindow.map(normValue => normalizedToMillivolts(normValue));

        // Step 2: Detect R-peak in the window (centered)
        const centerIdx = Math.floor(ecgWindow.length / 2);
        const searchRange = 30;

        let maxIdx = centerIdx;
        let maxValue = mVSignal[centerIdx];

        for (let i = Math.max(0, centerIdx - searchRange);
            i < Math.min(ecgWindow.length, centerIdx + searchRange);
            i++) {
            if (Math.abs(mVSignal[i]) > Math.abs(maxValue)) {
                maxValue = mVSignal[i];
                maxIdx = i;
            }
        }

        // Step 2b: Shift window so R-peak is centered
        const shift = centerIdx - maxIdx;
        const shifted = Array(ecgWindow.length);
        for (let i = 0; i < ecgWindow.length; i++) {
            const src = (i - shift + ecgWindow.length) % ecgWindow.length;
            shifted[i] = mVSignal[src];
        }

        // Step 3: Polarity correction (R-peaks should be positive)
        let needsFlip = false;
        if (maxValue < 0) needsFlip = true;

        const polarityCorrectedSignal = needsFlip
            ? shifted.map(x => -x)
            : shifted;

        const mean = polarityCorrectedSignal.reduce((a, b) => a + b, 0) / polarityCorrectedSignal.length;
        const std = Math.sqrt(polarityCorrectedSignal.reduce((a, b) => a + (b - mean) ** 2, 0) / polarityCorrectedSignal.length);

        // Unified threshold for flat signal
        if (std < FLAT_SIGNAL_STD_THRESHOLD) {
            return new Array(ecgWindow.length).fill(0);
        }

        return polarityCorrectedSignal;
    };

    // AI analysis (memoized to avoid interval recreation)
    const AianalyzeCurrent = React.useCallback(async () => {
        if (!ecgModel) {
            setModelPrediction({ prediction: "Analyzing", confidence: 0 });
            return;
        }

        // Dynamically import TensorFlow for tensor operations
        const { loadTensorFlow } = await import('../lib/tfLoader');
        const tf = await loadTensorFlow();
        if (!tf) {
            setModelPrediction({ prediction: "TF Error", confidence: 0 });
            return;
        }

        // Convert signal to mV for quality check
        const mVData = dataCh0.current.map(normValue => normalizedToMillivolts(normValue));
        const mean = mVData.reduce((sum, val) => sum + val, 0) / mVData.length;
        const variance = mVData.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / mVData.length;

        // Quality thresholds in mV (e.g., 0.05 mV = 50 μV)
        if (Math.max(...mVData.map(Math.abs)) < 0.05 || variance < 0.001) {
            setModelPrediction({ prediction: "Poor Signal", confidence: 0 });
            return;
        }

        // Use PQRSTDetector for peak detection
        const pqrstPointsArr = pqrstDetector.current.detectDirectWaves(dataCh0.current);
        const recentPeaks = pqrstPointsArr.filter(p => p.type === 'R').map(p => p.index);


        // Filter peaks to ensure physiological plausibility
        const filteredPeaks = recentPeaks.filter((peak, index) => {
            if (index === 0) return true;
            const timeDiff = (peak - recentPeaks[index - 1]) / SAMPLE_RATE * 1000;
            // Physiological bounds: 300-1500ms (≈40-200 BPM)
            return timeDiff >= 300 && timeDiff <= 1500;
        });

        if (filteredPeaks.length === 0) {

            setModelPrediction({ prediction: "No Valid Beats", confidence: 0 });
            return;
        }

        // Get the most recent R-peak
        const latestRPeak = filteredPeaks[filteredPeaks.length - 1];
        const halfBeat = Math.floor(MODEL_INPUT_LENGTH / 2); // 67 samples

        let ecgWindow: number[] = [];
        const startIdx = latestRPeak - halfBeat;

        // Create a properly ordered window
        for (let i = 0; i < MODEL_INPUT_LENGTH; i++) {
            const actualIdx = (startIdx + i + NUM_POINTS) % NUM_POINTS;
            ecgWindow.push(dataCh0.current[actualIdx]);
        }

        // Adapt signal to match training data characteristics
        const adaptedSignal = adaptSignalForModel(ecgWindow);

        // Now apply z-score normalization to adapted signal
        const windowMean = adaptedSignal.reduce((a, b) => a + b, 0) / adaptedSignal.length;
        const windowStd = Math.sqrt(adaptedSignal.reduce((a, b) => a + (b - windowMean) ** 2, 0) / adaptedSignal.length);

        // Unified threshold for flat signal
        if (windowStd < FLAT_SIGNAL_STD_THRESHOLD) {
            setModelPrediction({ prediction: "Flat Signal", confidence: 0 });
            return;
        }

        const normWindow = adaptedSignal.map(x => (x - windowMean) / windowStd);

        // Validate normalized data
        const normMean = normWindow.reduce((a, b) => a + b, 0) / normWindow.length;
        const normStd = Math.sqrt(normWindow.reduce((a, b) => a + (b - normMean) ** 2, 0) / normWindow.length);


        // More lenient validation for consumer devices
        if (Math.abs(normMean) > 0.3) {

            setModelPrediction({ prediction: "Normalization Failed", confidence: 0 });
            return;
        }

        // Create input tensor with correct shape [1, 135, 1]
        const inputTensor = tf.tensor3d([normWindow.map((v: number) => [v])], [1, MODEL_INPUT_LENGTH, 1]);


        try {
            const outputTensor = ecgModel.predict(inputTensor) as any;
            const probabilities = await outputTensor.data();

            if (!probabilities || probabilities.length === 0) {
                console.error("Model output is empty or invalid");
                setModelPrediction({ prediction: "Model Error", confidence: 0 });
                inputTensor.dispose();
                return;
            }

            const predArray = Array.from(probabilities) as number[];

            const deviceBiasCorrection = [
                1.4,  // Normal: moderate boost (reduced from 1.8)
                0.9,  // Supraventricular: mild reduction (increased from 0.7)
                1.0,  // Ventricular: no change
                0.8,  // Fusion: mild reduction (increased from 0.6)
                0.7   // Other: mild reduction (increased from 0.5)
            ];

            const correctedProbs = predArray.map((prob, idx) => (prob as number) * deviceBiasCorrection[idx]);
            const correctedSum = correctedProbs.reduce((a, b) => a + b, 0);
            const normalizedProbs = correctedProbs.map(p => p / correctedSum);

            const maxIndex = normalizedProbs.indexOf(Math.max(...normalizedProbs));
            const confidence = normalizedProbs[maxIndex] * 100;

            // Confidence threshold
            if (confidence < 40) {

                setModelPrediction({ prediction: "Uncertain", confidence });
                inputTensor.dispose();
                outputTensor.dispose();
                return;
            }

            if (maxIndex < 0 || maxIndex >= classLabels.length) {

                setModelPrediction({ prediction: "Classification Error", confidence: 0 });
                inputTensor.dispose();
                outputTensor.dispose();
                return;
            }

            const predictedClass = classLabels[maxIndex];

            setModelPrediction({
                prediction: predictedClass,
                confidence: confidence
            });

            inputTensor.dispose();
            outputTensor.dispose();
        } catch (err) {

            setModelPrediction({ prediction: "Prediction Error", confidence: 0 });
            inputTensor.dispose();
        }
    }, [ecgModel, classLabels]);

    useEffect(() => {
        if (!showPQRST) return;

        const pqrstUpdateInterval = setInterval(() => {
            const currentPoints = pqrstPoints.current;

            // No data → do nothing
            if (!currentPoints || currentPoints.length === 0) return;

            // Compare by length + last point position to avoid deep checks
            const currentSignature = `${currentPoints.length}-${currentPoints[currentPoints.length - 1]?.absolutePosition || 0}`;

            // Update state only when data changes
            if (lastPQRSTStrRef.current !== currentSignature) {
                lastPQRSTStrRef.current = currentSignature;
                setVisiblePQRST([...currentPoints]);
            }
        }, 200);

        return () => clearInterval(pqrstUpdateInterval);
    }, [showPQRST]);

    useEffect(() => {
        if (!appActive) return; // Don't run when idle

        const signalQualityInterval = setInterval(() => {
            if (!connected) {
                setSignalQuality('no-signal');
                return;
            }

            // Calculate signal quality metrics
            const maxAbs = Math.max(...dataCh0.current.map(Math.abs));
            const variance = dataCh0.current.reduce((sum, val) => sum + Math.pow(val, 2), 0) / dataCh0.current.length;

            // Relaxed thresholds - allow lower amplitude signals through
            if (maxAbs < 0.05 || variance < 0.0001) {
                setSignalQuality('no-signal');
            } else if (maxAbs < 0.15 || variance < 0.003) {
                setSignalQuality('poor');
            } else {
                setSignalQuality('good');
            }
        }, 1000);

        return () => clearInterval(signalQualityInterval);
    }, [appActive, connected]);


    const analyzeSTSegment = (pqrstPoints: PQRSTPoint[]): STSegmentData | null => {
        // Find relevant points
        const sPoint = pqrstPoints.find(p => p.type === 'S');
        const tPoint = pqrstPoints.find(p => p.type === 'T');
        const qPoint = pqrstPoints.find(p => p.type === 'Q');

        if (!sPoint || !tPoint || !qPoint) {
            return null;
        }

        // Find J-point (end of S-wave)
        const jPointIndex = sPoint.index;

        // Get ST segment point (80ms after J-point)
        const stPointIndex = jPointIndex + Math.floor(0.08 * SAMPLE_RATE);

        // Validate ST point is within reasonable bounds (between S and T)
        if (stPointIndex < sPoint.index || stPointIndex > tPoint.index) {
            return null; // ST point outside valid range
        }

        // Get baseline as PR segment level (or use isoelectric line)
        const baseline = qPoint.amplitude;

        // Find ST point value (interpolate if needed)
        let stValue;
        const stPoint = pqrstPoints.find(p => p.index === stPointIndex);
        if (stPoint) {
            stValue = stPoint.amplitude;
        } else {
            // Interpolate between S and T if exact point not available
            const ratio = (stPointIndex - sPoint.index) / (tPoint.index - sPoint.index);
            stValue = sPoint.amplitude + ratio * (tPoint.amplitude - sPoint.amplitude);
        }

        // Validate amplitude values are reasonable
        if (!Number.isFinite(stValue) || !Number.isFinite(baseline)) {
            return null;
        }

        // Calculate ST deviation in mm (1mm = 0.1mV in standard ECG)
        const deviation = (stValue - baseline) * 10;

        // Validate deviation is within physiological bounds (±5mm)
        if (Math.abs(deviation) > 5.0) {
            return null; // Likely artifact or noise
        }

        // Determine status using standard clinical thresholds
        let status: 'normal' | 'elevation' | 'depression' = 'normal';
        if (deviation >= 1.0) status = 'elevation';
        else if (deviation <= -0.5) status = 'depression';

        return { deviation, status };
    };

    // Auto-run AI analysis when panel is visible
    useEffect(() => {
        if (!showAIAnalysis || !connected) return;
        if (!ecgModel) return;

        // Run initial analysis immediately
        AianalyzeCurrent();

        // Auto-refresh every 3 seconds
        const interval = setInterval(() => {
            AianalyzeCurrent();
        }, 3000);

        return () => {
            clearInterval(interval);
        };
    }, [showAIAnalysis, ecgModel, connected, AianalyzeCurrent]);

    // Recording timer effect
    useEffect(() => {
        if (!isRecording) {
            recordingStartRef.current = null;
            setRecordingTime("00:00");
            return;
        }

        // Initialize once when recording starts
        if (recordingStartRef.current === null) {
            recordingStartRef.current = Date.now();
        }

        const timerInterval = setInterval(() => {
            const elapsedSeconds = Math.floor(
                (Date.now() - recordingStartRef.current!) / 1000
            );

            const min = String(Math.floor(elapsedSeconds / 60)).padStart(2, "0");
            const sec = String(elapsedSeconds % 60).padStart(2, "0");

            setRecordingTime(`${min}:${sec}`);
        }, 1000);

        return () => clearInterval(timerInterval);
    }, [isRecording]);

    // Periodically flush buffer to recordedData (both state AND ref for stopRecording)
    useEffect(() => {
        if (!isRecording) return;
        const id = setInterval(() => {
            if (recordBufferRef.current.length > 0) {
                const flushed = recordBufferRef.current.splice(0);
                recordedDataRef.current.push(...flushed);
                setRecordedData(prev => prev.concat(flushed));
            }
        }, 250);
        return () => clearInterval(id);
    }, [isRecording]);

    const startRecording = (patientInfo: PatientInfo) => {
        setIsRecording(true);
        setRecordedData([]);
        recordBufferRef.current = [];
        recordedDataRef.current = [];

        // Reset session analyzer to prevent data leakage between recordings
        sessionAnalyzer.current.reset();

        // Create new session metadata
        setCurrentSession({
            id: Date.now().toString(),
            startTime: Date.now(),
            endTime: null,
            duration: 0,
            patientInfo,
            ecgData: [],
            sampleRate: SAMPLE_RATE,
            rPeaks: [],
            pqrstPoints: []
        });
    };

    const stopRecording = () => {
        if (!isRecording || !currentSession || !recordingStartRef.current) {
            return null;
        }

        const endTime = Date.now();
        const duration = (endTime - recordingStartRef.current) / 1000;

        // Flush any remaining buffered samples into recordedData snapshot
        const recordedDataSnapshot = recordedDataRef.current.concat(recordBufferRef.current.splice(0));
        setRecordedData(recordedDataSnapshot);
       
        // Use shared detector on full snapshot (this is critical!)
        const freshRPeaks = detectRPeaksECG(recordedDataSnapshot, SAMPLE_RATE, { adaptiveThreshold: true });
        
        // Verify data isn't empty
        if (recordedDataSnapshot.length === 0) {
         }
        if (freshRPeaks.length === 0) {
             if (recordedDataSnapshot.length > 0) {
                const maxAbs = Math.max(...recordedDataSnapshot.map(Math.abs));
                const mean = recordedDataSnapshot.reduce((a, b) => a + b, 0) / recordedDataSnapshot.length;
                console.log(`[stopRecording] snapshot stats: maxAbs=${maxAbs.toFixed(4)}, mean=${mean.toFixed(4)}`);
            }
        }

        // Use PQRST detector for interval points (separate from peak detection)
        const freshPQRST = pqrstDetector.current.detectWaves(recordedDataSnapshot, freshRPeaks, 0);
        console.log(`[stopRecording] detectWaves returned ${freshPQRST.length} PQRST points: ${freshPQRST.map(p => `${p.type}@${p.absolutePosition}`).join(', ')}`);
        
        const freshIntervals = intervalCalculator.current.calculateIntervals(freshPQRST);
        
        // Calculate ST segment analysis from PQRST points
        const freshSTSegment = analyzeSTSegment(freshPQRST);
      
        const updatedSession: RecordingSession = {
            ...currentSession,
            endTime,
            duration,
            ecgData: recordedDataSnapshot,
            rPeaks: freshRPeaks,
            pqrstPoints: freshPQRST,
            intervals: freshIntervals || null,
            stSegmentData: freshSTSegment || null
        };

        setCurrentSession(updatedSession);
        setIsRecording(false);

        analyzeSession(updatedSession);

        return updatedSession;
    };

    const analyzeSession = async (session: RecordingSession) => {
        try {
            // Data-driven session analysis
            const results = await sessionAnalyzer.current.analyzeSession(session);
            setSessionResults(results);
            setShowSessionReport(true);
        } catch (err) {
            console.error('Session analysis failed:', err);
        }
    };

    const saveSessionReport = () => {
        if (!sessionResults || !currentSession) return;

        // Create CSV content
        let csvContent = "data:text/csv;charset=utf-8,";
        csvContent += "ECG Summary Report\n";
        csvContent += `Generated on,${new Date().toLocaleString()}\n\n`;

        // Add patient info
        csvContent += "Patient Information\n";
        csvContent += `Age,${currentSession.patientInfo.age}\n`;
        csvContent += `Gender,${currentSession.patientInfo.gender === 'male' ? 'Male' : 'Female'}\n`;
        csvContent += `Weight,${currentSession.patientInfo.weight} kg\n`;
        csvContent += `Height,${currentSession.patientInfo.height} cm\n\n`;

        // Add summary
        csvContent += "Summary\n";
        csvContent += `Recording Duration,${sessionResults.summary.recordingDuration}\n`;
        csvContent += `Average Heart Rate,${sessionResults.summary.heartRate.average.toFixed(1)} BPM\n`;
        csvContent += `Heart Rate Range,${sessionResults.summary.heartRate.min.toFixed(0)}-${sessionResults.summary.heartRate.max.toFixed(0)} BPM\n`;
        csvContent += `ECG Classification,${sessionResults.aiClassification.prediction}\n`;
        csvContent += `Classification Confidence,${sessionResults.aiClassification.confidence.toFixed(1)}%\n\n`;


        // Create download link
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `ecg-session-report-${new Date().toISOString().slice(0, 10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const pendingStateUpdateRef = useRef<NodeJS.Timeout | null>(null);

    // Debounced update for visible PQRST points
    const debouncedSetVisiblePQRST = React.useCallback((points: PQRSTPoint[]) => {
        // Cancel pending update if new data arrives
        if (pendingStateUpdateRef.current) {
            clearTimeout(pendingStateUpdateRef.current);
        }

        // Schedule update for 50ms from now
        pendingStateUpdateRef.current = setTimeout(() => {
            setVisiblePQRST(points);
        }, 50);
    }, []);

    // Cleanup debounced timeout on unmount
    useEffect(() => {
        return () => {
            if (pendingStateUpdateRef.current) {
                clearTimeout(pendingStateUpdateRef.current);
            }
        };
    }, []);

    return (
        <div className="relative w-full h-full bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 ">
            {/* Patient Info Modal (overlay, not in sidebar) */}
            {showPatientInfo && (
                <SessionRecording
                    onStartRecording={startRecording}
                    onClose={() => setShowPatientInfo(false)}
                />
            )}
            {showSessionReport && sessionResults && (
                <SessionReport
                    analysisResults={sessionResults}
                    patientInfo={currentSession?.patientInfo ?? {
                        age: 0,
                        gender: 'male',
                        weight: 0,
                        height: 0,
                        medicalHistory: [],
                        medications: []
                    }}
                    sessionDate={new Date(currentSession?.startTime ?? Date.now())}
                    recordingTime={recordingTime}
                    onClose={() => setShowSessionReport(false)}
                    onSaveReport={saveSessionReport}
                />
            )}

            {/* Grid background */}
            <div className="absolute inset-0 opacity-10">
                <div className="h-full w-full bg-grid-pattern bg-[size:40px_40px]"></div>
            </div>

            {/* Main canvas */}
            <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full"
                style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)' }}
            />

            {/* Improved Fixed Sidebar */}
            <div className="fixed left-0 top-0 h-full z-60 flex items-center">
                <div
                    className="group h-full py-6 px-2 bg-black backdrop-blur border-r border-white/10 flex flex-col items-center justify-center transition-all duration-300 hover:w-[240px] w-16"
                >
                    {/* Connect Device Button */}
                    <div className="relative w-full mb-5">
                        <div className="flex">
                            <div className="w-16 flex justify-center">
                                <button
                                    onClick={connected ? undefined : connect}
                                    className={`w-10 h-10 flex items-center justify-center rounded-full 
                                                ${connected
                                            ? 'bg-green-500/20 text-green-400 border border-green-500/30 cursor-not-allowed'
                                            : 'bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30'
                                        }`}
                                    title={connected ? 'Connected' : 'Connect Device'}
                                    aria-label={connected ? 'Connected' : 'Connect Device'}
                                >
                                    <Bluetooth className="w-5 h-5" />
                                </button>
                            </div>
                            <div className="whitespace-nowrap hidden group-hover:flex items-center">
                                <span className={`text-sm font-medium ${connected ? 'text-green-400' : 'text-blue-400'}`}>
                                    {connected ? 'Connected' : 'Connect Device'}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* PQRST Button */}
                    <div className="relative w-full mb-5">
                        <div className="flex">
                            <div className="w-16 flex justify-center">
                                <button
                                    onClick={() => setShowPQRST(!showPQRST)}
                                    className={`w-10 h-10 flex items-center justify-center rounded-full 
                                                ${showPQRST
                                            ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30 hover:bg-orange-500/30'
                                            : 'bg-gray-500/20 text-gray-400 border border-gray-500/30 hover:bg-gray-500/30'
                                        }`}
                                    title={showPQRST ? 'Hide PQRST' : 'Show PQRST'}
                                    aria-label={showPQRST ? 'Hide PQRST' : 'Show PQRST'}
                                >
                                    <Activity className="w-5 h-5" />
                                </button>
                            </div>
                            <div className="whitespace-nowrap hidden group-hover:flex items-center">
                                <span className={`text-sm font-medium ${showPQRST ? 'text-orange-400' : 'text-gray-400'}`}>
                                    {showPQRST ? 'Hide PQRST' : 'Show PQRST'}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* HRV Button */}
                    <div className="relative w-full mb-5">
                        <div className="flex">
                            <div className="w-16 flex justify-center">
                                <button
                                    onClick={() => setShowHRV(!showHRV)}
                                    className={`w-10 h-10 flex items-center justify-center rounded-full 
                                                ${showHRV
                                            ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30 hover:bg-purple-500/30'
                                            : 'bg-gray-500/20 text-gray-400 border border-gray-500/30 hover:bg-gray-500/30'
                                        }`}
                                    title={showHRV ? 'Hide HRV' : 'Show HRV'}
                                    aria-label={showHRV ? 'Hide HRV Analysis' : 'Show HRV Analysis'}
                                >
                                    <TrendingUp className="w-5 h-5" />
                                </button>
                            </div>
                            <div className="whitespace-nowrap hidden group-hover:flex items-center">
                                <span className={`text-sm font-medium ${showHRV ? 'text-purple-400' : 'text-gray-400'}`}>
                                    {showHRV ? 'Hide HRV' : 'Show HRV Analysis'}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Intervals Button */}
                    <div className="relative w-full mb-5">
                        <div className="flex">
                            <div className="w-16 flex justify-center">
                                <button
                                    onClick={() => setShowIntervals(!showIntervals)}
                                    className={`w-10 h-10 flex items-center justify-center rounded-full 
                                                ${showIntervals
                                            ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/30'
                                            : 'bg-gray-500/20 text-gray-400 border border-gray-500/30 hover:bg-gray-500/30'
                                        }`}
                                    title={showIntervals ? 'Hide Intervals' : 'Show Intervals'}
                                    aria-label={showIntervals ? 'Hide Intervals' : 'Show Intervals'}
                                >
                                    <Activity className="w-5 h-5" />
                                </button>
                            </div>
                            <div className="whitespace-nowrap hidden group-hover:flex items-center">
                                <span className={`text-sm font-medium ${showIntervals ? 'text-cyan-400' : 'text-gray-400'}`}>
                                    {showIntervals ? 'Hide Intervals' : 'ECG Intervals'}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Recording Button */}
                    <div className="relative w-full mb-5">
                        <div className="flex">
                            <div className="w-16 flex justify-center">
                                <button
                                    onClick={() => isRecording ? stopRecording() : setShowPatientInfo(true)}
                                    disabled={!connected}
                                    className={`w-10 h-10 flex items-center justify-center rounded-full 
                                                ${!connected ? 'bg-gray-500/20 text-gray-500 border border-gray-500/30 cursor-not-allowed' :
                                            isRecording
                                                ? 'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 animate-pulse'
                                                : 'bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30'
                                        }`}
                                    title={isRecording ? 'Stop Recording' : 'Start Recording'}
                                    aria-label={isRecording ? 'Stop Recording' : 'Start Recording'}
                                >
                                    {isRecording ? <Square className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                                </button>
                            </div>
                            <div className="flex items-center gap-2 whitespace-nowrap hidden group-hover:flex">
                                <span className={`text-sm font-medium ${isRecording ? 'text-red-400' : 'text-blue-400'}`}>
                                    {isRecording ? 'Stop Recording' : 'Start Recording'}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* AI Analysis Button */}
                    <div className="relative w-full mb-5">
                        <div className="flex">
                            <div className="w-16 flex justify-center">
                                <button
                                    onClick={handleAIClick}
                                    disabled={modelLoading}
                                    className={`w-10 h-10 flex items-center justify-center rounded-full 
                                                ${modelLoading ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30 cursor-wait' :
                                            showAIAnalysis
                                                ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 hover:bg-yellow-500/30'
                                                : 'bg-gray-500/20 text-gray-400 border border-gray-500/30 hover:bg-gray-500/30'
                                        }`}
                                    title={modelLoading ? 'Loading model...' : showAIAnalysis ? 'Hide AI Analysis' : 'Show AI Analysis'}
                                    aria-label={modelLoading ? 'Loading model...' : showAIAnalysis ? 'Hide AI Analysis' : 'Show AI Analysis'}
                                >
                                    <Zap className="w-5 h-5" />
                                </button>
                            </div>
                            <div className="whitespace-nowrap hidden group-hover:flex items-center">
                                <span className={`text-sm font-medium ${modelLoading ? 'text-blue-400' : showAIAnalysis ? 'text-yellow-400' : 'text-gray-400'}`}>
                                    {modelLoading ? 'Loading model...' : showAIAnalysis ? 'Hide AI Analysis' : 'AI Beat Analysis'}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* HRV Panel */}
            {showHRV && (
                <div className="absolute left-20 top-1/2 transform -translate-y-1/2 w-80 bg-black/60 backdrop-blur-sm border border-white/20 rounded-xl p-4 text-white z-30">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-bold flex items-center gap-2">
                            <TrendingUp className="w-5 h-5 text-blue-400" />
                            HRV Analysis
                        </h3>
                        <button
                            onClick={() => setShowHRV(false)}
                            className="text-gray-400 hover:text-white"
                        >
                            ✕
                        </button>
                    </div>

                    {hrvMetrics && hrvMetrics.sampleCount > 0 ? (
                        <>
                            {/* Physiological State (previously Mental State) */}
                            <div className="mb-4 p-3 rounded-lg border border-white/20 bg-black/40">
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-sm text-gray-300">Physiological State:</span>
                                    <span className="font-bold text-lg" style={{
                                        color:
                                            physioState.state === "High Stress" ? "#ef4444" :
                                                physioState.state === "Relaxed" ? "#22c55e" :
                                                    physioState.state === "Focused" ? "#3b82f6" :
                                                        physioState.state === "Fatigue" ? "#f97316" :
                                                            physioState.state === "Analyzing" ? "#94a3b8" : "#94a3b8"
                                    }}>
                                        {physioState.state}
                                    </span>
                                </div>
                                <div className="w-full bg-gray-700 rounded-full h-1.5">
                                    <div
                                        className="h-1.5 rounded-full"
                                        style={{
                                            width: `${physioState.confidence * 100}%`,
                                            backgroundColor:
                                                physioState.state === "High Stress" ? "#ef4444" :
                                                    physioState.state === "Relaxed" ? "#22c55e" :
                                                        physioState.state === "Focused" ? "#3b82f6" :
                                                            physioState.state === "Fatigue" ? "#f97316" :
                                                                physioState.state === "Analyzing" ? "#94a3b8" : "#94a3b8"
                                        }}
                                    ></div>
                                </div>
                                <p className="text-xs text-gray-400 mt-1">
                                    Confidence: {Number.isFinite(physioState.confidence) ? (physioState.confidence * 100).toFixed(0) : '0'}%
                                </p>
                            </div>

                            {/* HRV Status */}
                            <div className="mb-4 p-3 rounded-lg border" style={{
                                backgroundColor: `${hrvMetrics.assessment.color}20`,
                                borderColor: `${hrvMetrics.assessment.color}40`
                            }}>
                                <div className="flex items-center justify-between">
                                    <span className="font-medium">Status:</span>
                                    <span className="font-bold" style={{ color: hrvMetrics.assessment.color }}>
                                        {hrvMetrics.assessment.status}
                                    </span>
                                </div>
                                <p className="text-sm text-gray-300 mt-1">
                                    {hrvMetrics.assessment.description}
                                </p>
                            </div>

                            {/* Time Domain Metrics */}
                            <div className="space-y-3">
                                <div className="flex justify-between">
                                    <span className="text-gray-300">RMSSD:</span>
                                    <span className="font-mono text-green-400">
                                        {Number.isFinite(hrvMetrics.rmssd) ? hrvMetrics.rmssd.toFixed(1) : '--'} ms
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-300">SDNN:</span>
                                    <span className="font-mono text-blue-400">
                                        {Number.isFinite(hrvMetrics.sdnn) ? hrvMetrics.sdnn.toFixed(1) : '--'} ms
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-300">pNN50:</span>
                                    <span className="font-mono text-yellow-400">
                                        {Number.isFinite(hrvMetrics.pnn50) ? hrvMetrics.pnn50.toFixed(1) : '--'}%
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-300">Triangular:</span>
                                    <span className="font-mono text-purple-400">
                                        {Number.isFinite(hrvMetrics.triangularIndex) ? hrvMetrics.triangularIndex.toFixed(1) : '--'}
                                    </span>
                                </div>
                            </div>

                            {/* Frequency Domain */}
                            <div className="mt-4 pt-4 border-t border-white/20">
                                <h4 className="text-sm font-medium text-gray-300 mb-2">Frequency Domain</h4>
                                <div className="mb-2 p-2 rounded border border-yellow-500/30 bg-yellow-500/10">
                                    <p className="text-xs text-yellow-300">⚠️ Approximate values - simplified calculation</p>
                                </div>
                                <div className="space-y-2">
                                    <div className="flex justify-between">
                                        <span className="text-gray-400 text-sm">LF Power:</span>
                                        <span className="font-mono text-blue-400 text-sm">
                                            {Number.isFinite(hrvMetrics.lfhf.lf) ? hrvMetrics.lfhf.lf.toFixed(2) : '--'} ms²
                                        </span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-gray-400 text-sm">HF Power:</span>
                                        <span className="font-mono text-green-400 text-sm">
                                            {Number.isFinite(hrvMetrics.lfhf.hf) ? hrvMetrics.lfhf.hf.toFixed(2) : '--'} ms²
                                        </span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-gray-400 text-sm">LF/HF Ratio:</span>
                                        <span className="font-mono text-orange-400 text-sm">
                                            {Number.isFinite(hrvMetrics.lfhf.ratio) ? hrvMetrics.lfhf.ratio.toFixed(2) : '--'}
                                            {Number.isFinite(hrvMetrics.lfhf.ratio) && (
                                                <span className="text-xs ml-1 text-gray-400">
                                                    {hrvMetrics.lfhf.ratio > 2.0 ? '(Sympathetic ↑)' :
                                                        hrvMetrics.lfhf.ratio < 0.5 ? '(Parasympathetic ↑)' : '(Balanced)'}
                                                </span>
                                            )}
                                        </span>
                                    </div>
                                </div>
                            </div>


                        </>
                    ) : (
                        <div className="text-center text-gray-400 py-8">
                            <div className="animate-spin w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full mx-auto mb-4"></div>
                            <p>Collecting heart beats...</p>
                            <p className="text-sm mt-2">Need at least 2 peaks for analysis</p>
                            {connected && (
                                <p className="text-xs mt-2">
                                    Connected - waiting for ECG data...
                                </p>
                            )}
                        </div>
                    )}
                </div>
            )}


            {/* AI Prediction Results Panel */}
            {showAIAnalysis && (
                <div className="absolute right-4 top-[calc(40%+40px)] transform -translate-y-1/2 w-96 bg-black/60 backdrop-blur-sm border border-white/20 rounded-xl p-4 text-white z-40">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-bold flex items-center gap-2">
                            <Zap className="w-5 h-5 text-yellow-400" />
                            AI Beat Classification
                        </h3>
                        <button
                            onClick={() => setShowAIAnalysis(false)}
                            className="text-gray-400 hover:text-white"
                        >
                            ✕
                        </button>
                    </div>
                    {/* Development Phase Disclaimer */}
                    <div className="mb-4 p-3 rounded-lg border border-orange-500/30 bg-orange-500/10 text-orange-400">
                        <div className="flex items-start gap-2">
                            <span className="text-lg">🚧</span>
                            <div>
                                <div className="text-sm font-semibold mb-1">Development Phase Notice</div>
                                <div className="text-xs text-orange-300">
                                    The AI feature is currently in testing and development phase. Results may not be accurate or reliable.
                                    We will inform you as soon as this feature is fully operational and validated.
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Real-time Analysis Status */}
                    <div className="mb-3 p-2 rounded-lg border border-blue-500/30 bg-blue-500/10">
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-blue-400">Analysis Status:</span>
                            <span className={`font-semibold ${modelLoaded && connected ? 'text-green-400' : 'text-yellow-400'}`}>
                                {modelLoaded && connected ? '🟢 Active (3 sec refresh)' :
                                    modelLoaded ? '🟡 Ready (connect device)' : '🔴 Loading model...'}
                            </span>
                        </div>

                    </div>

                    {/* Current Beat Analysis */}
                    {modelPrediction && (
                        <div className="mb-4 p-3 rounded-lg border border-white/20 bg-black/40">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm text-gray-300">Latest Beat:</span>
                                <span className={`font-bold text-lg ${modelPrediction.prediction === "Normal" ? 'text-green-400' :
                                    modelPrediction.prediction === "Uncertain" || modelPrediction.prediction === "Poor Signal" ? 'text-yellow-400' :
                                        modelPrediction.prediction.includes("Error") ? 'text-red-400' : 'text-orange-400'
                                    }`}>
                                    {modelPrediction.prediction}
                                </span>
                            </div>

                            {modelPrediction.confidence > 0 && (
                                <>
                                    <div className="w-full bg-gray-700 rounded-full h-2 mb-2">
                                        <div
                                            className="h-2 rounded-full transition-all duration-300"
                                            style={{
                                                width: `${modelPrediction.confidence}%`,
                                                backgroundColor:
                                                    modelPrediction.confidence >= 80 ? '#22c55e' :
                                                        modelPrediction.confidence >= 60 ? '#eab308' : '#ef4444'
                                            }}
                                        ></div>
                                    </div>
                                    <div className="text-xs text-gray-400">
                                        Confidence: {Number.isFinite(modelPrediction.confidence) ? modelPrediction.confidence.toFixed(1) : '0'}%
                                        {modelPrediction.confidence >= 70 && <span className="text-green-400 ml-2">✓ High</span>}
                                        {modelPrediction.confidence >= 45 && modelPrediction.confidence < 70 && <span className="text-yellow-400 ml-2">~ Medium</span>}
                                        {modelPrediction.confidence < 45 && <span className="text-red-400 ml-2">⚠ Low</span>}
                                    </div>
                                </>
                            )}
                        </div>
                    )}


                    {/* Enhanced disclaimer */}
                    <div className="mt-3 text-xs text-gray-300 italic border-t border-gray-700 pt-3">
                        <div className="mb-1">⚠️ <strong>Medical Disclaimer:</strong> This is not a diagnostic device.</div>
                        <div className="text-gray-400">
                            AI predictions are experimental and should not replace professional medical evaluation.
                        </div>
                    </div>
                </div>
            )}

            {/* ECG Intervals Panel */}
            {showIntervals && (
                <div className="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[700px] 
          bg-black/60 backdrop-blur-sm border border-white/20 rounded-xl p-6 text-white z-10">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-bold flex items-center gap-2">
                            <Activity className="w-5 h-5 text-blue-400" />
                            Heart Signal Analysis
                        </h3>
                        <button
                            onClick={() => setShowIntervals(false)}
                            className="text-gray-400 hover:text-white"
                        >
                            ✕
                        </button>
                    </div>

                    {/* Add this line for user instruction */}
                    <div className="mb-4 text-center text-xs text-yellow-300 font-semibold">
                        Please stay still for accurate readings.
                    </div>

                    <div className="flex gap-4">
                        {/* Left column - description and gender */}
                        <div className="w-1/3">
                            {/* Add a simple explanation */}
                            <p className="text-sm text-gray-300 mb-4">
                                This panel analyzes your heartbeat timing patterns. These measurements can reveal important information about heart health.
                            </p>

                            {/* Disclaimer */}
                            <div className="mt-auto pt-4 text-xs text-gray-500 italic">
                                This is not a medical device. Do not use for diagnosis or treatment decisions.
                            </div>
                            <div className="mt-4 text-xs text-gray-300 italic border-t border-gray-700 pt-3">

                                <div>Features are currently experimental and under development.</div>
                            </div>
                        </div>

                        {/* Right column - metrics */}
                        <div className="w-2/3">
                            {ecgIntervals ? (
                                <>
                                    {/* Heart Rate (BPM) - Full width */}
                                    <div className="p-3 rounded-lg border border-white/20 bg-black/40 mb-4">
                                        <div className="flex items-center justify-between">
                                            <span className="text-gray-300">Heart Rate:</span>
                                            <span className={`font-mono font-bold text-xl ${smoothedBpm === 0 ? 'text-gray-400' :
                                                smoothedBpm >= 60 && smoothedBpm <= 100 ? 'text-green-400' :
                                                    smoothedBpm < 60 ? 'text-yellow-400' :
                                                        'text-red-400'
                                                }`}>
                                                {smoothedBpm > 0 ? smoothedBpm.toFixed(0) : "--"} BPM
                                            </span>
                                        </div>
                                        <div className="text-xs text-gray-400 mt-1">
                                            How many times your heart beats per minute. Normal is 60-100 BPM.
                                        </div>
                                    </div>

                                    {/* Two-column layout for metrics */}
                                    <div className="grid grid-cols-2 gap-3">
                                        {/* RR Interval with explanation */}
                                        <div className="p-3 rounded-lg border border-white/20 bg-black/40">
                                            <div className="flex justify-between items-center">
                                                <span className="text-gray-300 text-sm">Beat-to-Beat:</span>
                                                <span className={`font-mono ${ecgIntervals.status.rr === 'normal' ? 'text-green-400' :
                                                    ecgIntervals.status.rr === 'short' ? 'text-yellow-400' :
                                                        ecgIntervals.status.rr === 'long' ? 'text-blue-400' : 'text-gray-400'
                                                    }`}>
                                                    {ecgIntervals.rr.toFixed(0)} ms
                                                </span>
                                            </div>
                                            <div className="text-xs text-gray-400 mt-1">
                                                R-R interval: 600-1000ms normal
                                            </div>
                                        </div>

                                        {/* PR Interval with explanation */}
                                        <div className="p-3 rounded-lg border border-white/20 bg-black/40">
                                            <div className="flex justify-between items-center">
                                                <span className="text-gray-300 text-sm">Conduction:</span>
                                                <span className={`font-mono ${ecgIntervals.status.pr === 'normal' ? 'text-green-400' :
                                                    ecgIntervals.status.pr === 'short' ? 'text-yellow-400' :
                                                        ecgIntervals.status.pr === 'long' ? 'text-red-400' : 'text-gray-400'
                                                    }`}>
                                                    {ecgIntervals.pr.toFixed(0)} ms
                                                </span>
                                            </div>
                                            <div className="text-xs text-gray-400 mt-1">
                                                PR interval: atria to ventricles
                                            </div>
                                        </div>

                                        {/* QRS Duration with explanation */}
                                        <div className="p-3 rounded-lg border border-white/20 bg-black/40">
                                            <div className="flex justify-between items-center">
                                                <span className="text-gray-300 text-sm">Activation:</span>
                                                <span className={`font-mono ${ecgIntervals.status.qrs === 'normal' ? 'text-green-400' :
                                                    ecgIntervals.status.qrs === 'wide' ? 'text-red-400' : 'text-gray-400'
                                                    }`}>
                                                    {ecgIntervals.qrs.toFixed(0)} ms
                                                </span>
                                            </div>
                                            <div className="text-xs text-gray-400 mt-1">
                                                QRS duration: ventricular activation
                                            </div>
                                        </div>

                                        {/* ST Segment data - added section */}
                                        {stSegmentData && (
                                            <div className="p-3 rounded-lg border border-white/20 bg-black/40">
                                                <div className="flex justify-between items-center">
                                                    <span className="text-gray-300 text-sm">ST Segment:</span>
                                                    <span className={`font-mono ${stSegmentData.status === 'normal' ? 'text-green-400' :
                                                        stSegmentData.status === 'elevation' ? 'text-red-400' :
                                                            'text-yellow-400'
                                                        }`}>
                                                        {Number.isFinite(stSegmentData.deviation) ? stSegmentData.deviation.toFixed(2) : '--'} mm
                                                    </span>
                                                </div>
                                                <div className="text-xs text-gray-400 mt-1">
                                                    {stSegmentData.status === 'normal' ? 'Normal ST segment' :
                                                        stSegmentData.status === 'elevation' ? 'ST elevation detected' :
                                                            'ST depression detected'}
                                                </div>
                                                {/* Add clinical threshold label */}
                                                <div className="text-xs text-blue-400 mt-1 italic">
                                                    Thresholds are set to standard clinical values (≥1.0 mm elevation, ≤-0.5 mm depression).
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Abnormality indicators - full width */}
                                    {ecgIntervals.status.pr === 'long' || ecgIntervals.status.qrs === 'wide' || ecgIntervals.status.qtc === 'prolonged' ? (
                                        <div className="mt-4 p-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10">
                                            <h4 className="text-sm font-medium text-yellow-400 mb-1">Patterns Detected:</h4>
                                            <ul className="space-y-1 text-xs">
                                                {ecgIntervals.status.pr === 'long' && (
                                                    <li className="flex items-center gap-1 text-yellow-400">
                                                        <span>•</span>
                                                        <span>Prolonged conduction time</span>
                                                    </li>
                                                )}
                                                {ecgIntervals.status.qrs === 'wide' && (
                                                    <li className="flex items-center gap-1 text-yellow-400">
                                                        <span>•</span>
                                                        <span>Wide QRS complex</span>
                                                    </li>
                                                )}

                                            </ul>
                                        </div>
                                    ) : (
                                        <div className="mt-4 p-3 rounded-lg border border-green-500/30 bg-green-500/10">
                                            <h4 className="text-sm font-medium text-green-400">All Timing Patterns Normal</h4>
                                        </div>
                                    )}

                                    <div className="mt-3 text-xs text-gray-400 text-center">
                                        Based on your most recent complete heartbeat
                                    </div>
                                </>
                            ) : (
                                <div className="text-center text-gray-400 py-10">
                                    <div className="animate-spin w-10 h-10 border-2 border-blue-400 border-t-transparent rounded-full mx-auto mb-4"></div>
                                    <p>Analyzing your heart signal...</p>
                                    <p className="text-sm mt-2">We need a complete heartbeat for analysis</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* PQRST text labels overlay */}
            {showPQRST && visiblePQRST.length > 0 && (
                <div className="absolute inset-0 pointer-events-none">
                    {(() => {
                        const scale = scaleFactorRef.current;
                        return visiblePQRST.map((point, i) => {
                            const xPercent = (point.index / NUM_POINTS) * 100;
                            const yOffset = 50 - (point.amplitude * scale * 50);

                            const colorClass =
                                point.type === 'P' ? 'text-orange-400' :
                                    point.type === 'Q' ? 'text-blue-400' :
                                        point.type === 'R' ? 'text-red-500' :
                                            point.type === 'S' ? 'text-cyan-400' :
                                                point.type === 'T' ? 'text-purple-400' : 'text-white';

                            return (
                                <div
                                    key={`pqrst-${point.type}-${point.index}-${i}`}
                                    className={`absolute font-bold ${colorClass}`}
                                    style={{
                                        left: `${xPercent}%`,
                                        top: `${yOffset}%`,
                                        transform: 'translate(-50%, -50%)',
                                        textShadow: '0 0 4px rgba(0,0,0,0.8)',
                                        willChange: 'transform'
                                    }}
                                >
                                    {point.type}
                                </div>
                            );
                        });
                    })()}
                </div>
            )}

            {/* Recording indicator */}
            {isRecording && (
                <div className="fixed top-6 left-1/2 transform -translate-x-1/2 z-80 flex items-center px-4 py-2 rounded-full bg-red-900/80 border border-red-500/30 shadowlg">
                    <Clock className="w-5 h-5 text-red-400 mr-2" />
                    <span className="font-mono text-lg text-red-400">{recordingTime}</span>
                    <span className="ml-1 text-xs text-red-400 font-semibold animate-pulse">Recording...</span>
                </div>
            )}
        </div>
    );
}
