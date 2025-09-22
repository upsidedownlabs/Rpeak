import React from 'react';
import { SessionAnalysisResults } from '../lib/sessionAnalyzer';
import { PatientInfo } from './SessionRecording';
import {
    FileText, User, Clock, Activity, Heart, TrendingUp,
    Zap, ClipboardList, AlertTriangle, CheckCircle, AlertCircle
} from 'lucide-react';

// Add this mapping for readable labels (updated for AAMI classes)
const predictionLabels: Record<string, string> = {
    "Normal Sinus Rhythm": "Normal Sinus Rhythm",
    "Ventricular Arrhythmia": "Ventricular Arrhythmia",
    "Supraventricular Arrhythmia": "Supraventricular Arrhythmia",
    "Fusion Beats Detected": "Fusion Beats Detected",
    "Abnormal Rhythm": "Abnormal Rhythm",
    "Mixed Rhythm Pattern": "Mixed Rhythm Pattern",
    "Bradycardia": "Bradycardia",
    "Tachycardia": "Tachycardia",
    "Analysis Failed": "Analysis Failed",
    "Error": "Analysis Error"
};

const predictionExplanations: Record<string, string> = {
    "Normal Sinus Rhythm": "Your heart's electrical activity appears normal with regular rhythm patterns. The AI detected predominantly normal heartbeats with consistent timing.",
    "Ventricular Arrhythmia": "Abnormal heartbeats originating from the ventricles detected. The AI identified irregular electrical patterns that may require medical attention.",
    "Supraventricular Arrhythmia": "Abnormal heartbeats originating above the ventricles detected. The AI found irregular patterns in the upper chambers of the heart.",
    "Fusion Beats Detected": "Mixed conduction patterns indicating fusion of normal and abnormal beats. The AI detected complex rhythm patterns with overlapping electrical activity.",
    "Abnormal Rhythm": "Irregular heart rhythm patterns that don't fit standard categories. The AI identified unusual electrical activity requiring further evaluation.",
    "Mixed Rhythm Pattern": "Complex rhythm with multiple types of abnormal beats detected. The AI found various irregular patterns throughout the recording.",
    "Bradycardia": "Slow heart rate detected (below 60 BPM). The AI confirmed consistently slow heart rhythm patterns.",
    "Tachycardia": "Fast heart rate detected (above 100 BPM). The AI confirmed consistently fast heart rhythm patterns.",
    "Analysis Failed": "Unable to analyze rhythm due to insufficient data or poor signal quality. The AI could not process the ECG data reliably.",
    "Error": "Technical error occurred during AI analysis. The classification system encountered processing difficulties."
};

// Beat classification labels for detailed breakdown
const beatLabels: Record<string, string> = {
    "normal": "Normal beats",
    "supraventricular": "Supraventricular beats",
    "ventricular": "Ventricular beats",
    "fusion": "Fusion beats",
    "other": "Other/Unknown beats"
};

export interface SessionReportProps {
    analysisResults: SessionAnalysisResults;
    patientInfo: PatientInfo;
    sessionDate: Date;
    recordingTime: string;
    onClose: () => void;
    onSaveReport: () => void;
}

export default function SessionReport({
    analysisResults,
    patientInfo,
    sessionDate,
    recordingTime,
    onClose,
    onSaveReport
}: SessionReportProps) {
    // Parse duration string to seconds
    function parseDuration(duration: string): number {
        const parts = duration.split(":").map(Number);
        if (parts.length === 3) {
            // hh:mm:ss
            return parts[0] * 3600 + parts[1] * 60 + parts[2];
        } else if (parts.length === 2) {
            // mm:ss
            return parts[0] * 60 + parts[1];
        }
        return 0;
    }

    const rPeaks = analysisResults.summary.rPeaks ?? [];
    const numBeats = rPeaks.length;
    const durationSeconds = parseDuration(analysisResults.summary.recordingDuration);
    const durationMinutes = durationSeconds / 60;

    // Determine overall status color based on findings
    const getOverallStatusColor = () => {
        if (analysisResults.abnormalities.some(abn => abn.severity === 'high')) {
            return '#ef4444'; // red
        } else if (analysisResults.abnormalities.some(abn => abn.severity === 'medium')) {
            return '#f59e0b'; // amber
        } else if (analysisResults.aiClassification.prediction === "Normal Sinus Rhythm") {
            return '#22c55e'; // green
        } else {
            return '#3b82f6'; // blue
        }
    };

    const getStatusIcon = () => {
        const hasHighSeverity = analysisResults.abnormalities.some(abn => abn.severity === 'high');
        const hasMediumSeverity = analysisResults.abnormalities.some(abn => abn.severity === 'medium');

        if (hasHighSeverity) {
            return <AlertTriangle className="w-5 h-5 text-red-400" />;
        } else if (hasMediumSeverity) {
            return <AlertCircle className="w-5 h-5 text-amber-400" />;
        } else {
            return <CheckCircle className="w-5 h-5 text-green-400" />;
        }
    };

    // Calculate AI analysis quality metrics
    const getAIAnalysisQuality = () => {
        const confidence = analysisResults.aiClassification.confidence;
        if (confidence >= 75) return { label: 'High Quality', color: '#22c55e', icon: '🟢' };
        if (confidence >= 60) return { label: 'Good Quality', color: '#eab308', icon: '🟡' };
        if (confidence >= 45) return { label: 'Medium Quality', color: '#f97316', icon: '🟠' };
        return { label: 'Lower Quality', color: '#ef4444', icon: '🔴' };
    };

    const aiQuality = getAIAnalysisQuality();

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-70 flex items-center justify-center p-4 w-full">
            <div className="bg-slate-900 border border-white/20 rounded-xl max-w-[90vw] w-full max-h-[90vh] overflow-y-auto">
                {/* Report Header */}
                <div className="sticky top-0 bg-slate-900 border-b border-white/10 p-2 flex justify-between items-center">
                    <h2 className="text-xl font-bold text-white flex items-center gap-2 mb-2">
                        <FileText className="w-5 h-5 text-blue-400" />
                        ECG Session Report
                        {getStatusIcon()}
                    </h2>

                    <div className="flex gap-3">

                        <button
                            onClick={onClose}
                            className="px-4 py-2 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800"
                        >
                            Close
                        </button>
                    </div>
                </div>

                <div className="px-6 pb-4">
                    {/* Session Summary Grid */}
                    <div className="mb-6">

                        <div className="grid grid-cols-4 gap-4 items-stretch">
                            {/* Session Info */}
                            <div className="flex flex-col h-full">
                                <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg px-3 py-3 flex-1">
                                    <h3 className="text-white font-medium flex items-center gap-2 mb-2 text-sm">
                                        <Clock className="w-4 text-blue-400" />
                                        Session Information
                                    </h3>
                                    <div className="grid grid-cols-2 gap-2 text-xs">
                                        <div className="text-gray-400">Date:</div>
                                        <div className="text-white">{sessionDate.toLocaleDateString()}</div>
                                        <div className="text-gray-400">Time:</div>
                                        <div className="text-white">{sessionDate.toLocaleTimeString()}</div>
                                        <div className="text-gray-400">Duration:</div>
                                        <div className="text-white">{analysisResults.summary.recordingDuration}</div>
                                        <div className="text-gray-400">Beats:</div>
                                        <div className="text-white">{numBeats} beats</div>
                                    </div>
                                </div>
                                <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg px-3 py-3 flex-1 mt-2">
                                    <h3 className="text-white font-medium flex items-center gap-2 mb-2 text-sm">
                                        <User className="w-4 text-blue-400" />
                                        Patient Information
                                    </h3>
                                    <div className="grid grid-cols-2 gap-2 text-xs">
                                        <div className="text-gray-400">Age:</div>
                                        <div className="text-white">{patientInfo.age} years</div>
                                        <div className="text-gray-400">Gender:</div>
                                        <div className="text-white">{patientInfo.gender === 'male' ? 'Male' : 'Female'}</div>
                                        <div className="text-gray-400">Weight:</div>
                                        <div className="text-white">{patientInfo.weight} kg</div>
                                        <div className="text-gray-400">Height:</div>
                                        <div className="text-white">{patientInfo.height} cm</div>
                                    </div>
                                </div>
                            </div>

                            {/* Heart Rate Variability */}
                            <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-3">
                                <h3 className="text-white font-medium flex items-center gap-2 mb-3 text-sm">
                                    <TrendingUp className="w-4 h-4 text-purple-400" />
                                    Heart Rate Variability
                                </h3>
                                <div className="grid grid-cols-2 gap-2 mb-3">
                                    <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-2">
                                        <div className="text-gray-400 text-xs mb-1">RMSSD</div>
                                        <div className="font-bold text-sm text-green-400">
                                            {analysisResults.hrv.timeMetrics.rmssd.toFixed(1)} <span className="text-xs">ms</span>
                                        </div>
                                    </div>
                                    <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-2">
                                        <div className="text-gray-400 text-xs mb-1">SDNN</div>
                                        <div className="font-bold text-sm text-blue-400">
                                            {analysisResults.hrv.timeMetrics.sdnn.toFixed(1)} <span className="text-xs">ms</span>
                                        </div>
                                    </div>
                                    <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-2">
                                        <div className="text-gray-400 text-xs mb-1">pNN50</div>
                                        <div className="font-bold text-sm text-yellow-400">
                                            {analysisResults.hrv.timeMetrics.pnn50.toFixed(1)} <span className="text-xs">%</span>
                                        </div>
                                    </div>
                                    <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-2">
                                        <div className="text-gray-400 text-xs mb-1">LF/HF</div>
                                        <div className="font-bold text-sm text-orange-400">
                                            {analysisResults.hrv.frequencyMetrics.lfhfRatio.toFixed(2)}
                                        </div>
                                    </div>
                                </div>
                                <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-2">
                                    <div className="flex justify-between mb-1">
                                        <div className="text-gray-400 text-xs">State:</div>
                                        <div className="font-medium text-xs" style={{
                                            color:
                                                analysisResults.hrv.physiologicalState.state === "High Stress" ? "#ef4444" :
                                                    analysisResults.hrv.physiologicalState.state === "Relaxed" ? "#22c55e" :
                                                        analysisResults.hrv.physiologicalState.state === "Focused" ? "#3b82f6" :
                                                            analysisResults.hrv.physiologicalState.state === "Fatigue" ? "#f97316" : "#94a3b8"
                                        }}>
                                            {analysisResults.hrv.physiologicalState.state}
                                        </div>
                                    </div>
                                    <div className="text-xs text-gray-300">
                                        {analysisResults.hrv.assessment.description}
                                    </div>
                                </div>
                            </div>

                            {/* Enhanced AI Classification & Beat Analysis */}
                            <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-3 col-span-2">
                                <h3 className="text-white font-medium flex items-center gap-2 mb-3 text-sm">
                                    <Zap className="w-4 h-4 text-yellow-400" />
                                    AI Rhythm Analysis
                                </h3>

                                {/* Development Notice - Spanning full width */}
                                <div className="mb-4 p-3 rounded-lg border border-orange-500/30 bg-orange-500/10 text-orange-400">
                                    <div className="flex items-start gap-2">
                                        <span className="text-lg">🚧</span>
                                        <div>
                                            <div className="text-xs font-semibold mb-1">Development Phase Notice</div>
                                            <div className="text-xs text-orange-300">
                                                AI feature is under testing. Results may be inaccurate. You'll be notified once fully validated.
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Two Column Layout */}
                                <div className="grid grid-cols-2 gap-4">
                                    {/* Left Column - Classification & Confidence */}
                                    <div className="space-y-3">


                                        {/* Beat Classification Breakdown */}
                                        {analysisResults.aiClassification.beatClassifications && (
                                            <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-3">
                                                <div className="text-xs font-medium text-gray-300 mb-2">Beat Pattern Analysis:</div>
                                                <div className="space-y-1 text-xs">
                                                    {Object.entries(analysisResults.aiClassification.beatClassifications).map(([beatType, count]) => {
                                                        const total = Object.values(analysisResults.aiClassification.beatClassifications!).reduce((sum, c) => sum + c, 0);
                                                        const percentage = total > 0 ? (count / total) * 100 : 0;
                                                        const color = beatType === 'normal' ? '#22c55e' :
                                                            beatType === 'ventricular' ? '#ef4444' :
                                                                beatType === 'supraventricular' ? '#f59e0b' :
                                                                    beatType === 'fusion' ? '#8b5cf6' : '#6b7280';

                                                        return (
                                                            <div key={beatType} className="flex justify-between">
                                                                <span className="text-gray-400">{beatLabels[beatType]}:</span>
                                                                <span style={{ color }}>{count} ({percentage.toFixed(1)}%)</span>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Right Column - Analysis Insights */}
                                    <div className="space-y-3">


                                        {/* AI Analysis Quality Metrics */}
                                        <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-3">
                                            <div className="text-xs font-medium text-gray-300 mb-2">Analysis Quality:</div>
                                            <div className="space-y-2">
                                                <div className="flex justify-between text-xs">
                                                    <span className="text-gray-400">Signal Quality:</span>
                                                    <span className="text-green-400">Good</span>
                                                </div>
                                                <div className="flex justify-between text-xs">
                                                    <span className="text-gray-400">Beats Analyzed:</span>
                                                    <span className="text-blue-400">{numBeats}</span>
                                                </div>
                                                <div className="flex justify-between text-xs">
                                                    <span className="text-gray-400">Pattern Consistency:</span>
                                                    <span style={{ color: aiQuality.color }}>
                                                        {analysisResults.aiClassification.confidence >= 70 ? 'High' :
                                                            analysisResults.aiClassification.confidence >= 50 ? 'Medium' : 'Variable'}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>


                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Heart Rate and Rhythm Section */}
                    <div className="mb-6">

                        <div className="grid grid-cols-4 gap-4">
                            <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4">
                                <div className="text-gray-400 text-sm mb-1">Average Heart Rate</div>
                                <div className={`font-bold text-2xl ${analysisResults.summary.heartRate.status === 'normal' ? 'text-green-400' :
                                    analysisResults.summary.heartRate.status === 'bradycardia' ? 'text-yellow-400' :
                                        'text-red-400'
                                    }`}>
                                    {analysisResults.summary.heartRate.average.toFixed(1)} <span className="text-sm">BPM</span>
                                </div>
                                <div className="text-xs text-gray-500 mt-1">
                                    {analysisResults.summary.heartRate.status === 'normal' ? 'Normal Range' :
                                        analysisResults.summary.heartRate.status === 'bradycardia' ? 'Bradycardia (Slow)' :
                                            'Tachycardia (Fast)'}
                                </div>
                            </div>

                            <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4">
                                <div className="text-gray-400 text-sm mb-1">Heart Rate Range</div>
                                <div className="font-medium">
                                    <span className="text-blue-400">{analysisResults.summary.heartRate.min.toFixed(0)}</span>
                                    <span className="text-gray-500 mx-2">-</span>
                                    <span className="text-red-400">{analysisResults.summary.heartRate.max.toFixed(0)}</span>
                                    <span className="text-sm text-gray-400 ml-1">BPM</span>
                                </div>
                                <div className="text-xs text-gray-500 mt-1">
                                    Min - Max during recording
                                </div>
                            </div>

                            <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4">
                                <div className="text-gray-400 text-sm mb-1">Rhythm Regularity</div>
                                <div className="font-medium">
                                    <span className={
                                        analysisResults.summary.rhythm.percentIrregular < 5 ? 'text-green-400' :
                                            analysisResults.summary.rhythm.percentIrregular < 15 ? 'text-yellow-400' :
                                                'text-red-400'
                                    }>
                                        {(100 - analysisResults.summary.rhythm.percentIrregular).toFixed(1)}%
                                    </span>
                                    <span className="text-sm text-gray-400 ml-1">Regular</span>
                                </div>
                                <div className="text-xs text-gray-500 mt-1">
                                    {analysisResults.summary.rhythm.irregularBeats} irregular beats
                                </div>
                            </div>

                            <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4">
                                <div className="text-gray-400 text-sm mb-1">AI Confidence</div>
                                <div className="font-medium">
                                    <span style={{ color: aiQuality.color }}>
                                        {analysisResults.aiClassification.confidence.toFixed(1)}%
                                    </span>
                                </div>
                                <div className="text-xs text-gray-500 mt-1">
                                    AI classification confidence
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* ECG Intervals Section */}
                    <div className="mb-2">

                        <div className="grid grid-cols-5 gap-3">
                            <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-3">
                                <div className="text-gray-400 text-xs mb-1">PR Interval</div>
                                <div className={`font-bold text-lg ${analysisResults.intervals.pr.status === 'normal' ? 'text-green-400' :
                                    analysisResults.intervals.pr.status === 'short' ? 'text-yellow-400' :
                                        'text-red-400'
                                    }`}>
                                    {analysisResults.intervals.pr.average.toFixed(0)} <span className="text-xs">ms</span>
                                </div>
                                <div className="text-xs text-gray-500 mt-1">
                                    {analysisResults.intervals.pr.status === 'normal' ? 'Normal' :
                                        analysisResults.intervals.pr.status === 'short' ? 'Short' : 'Prolonged'}
                                </div>
                            </div>

                            <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-3">
                                <div className="text-gray-400 text-xs mb-1">QRS Duration</div>
                                <div className={`font-bold text-lg ${analysisResults.intervals.qrs.status === 'normal' ? 'text-green-400' : 'text-red-400'
                                    }`}>
                                    {analysisResults.intervals.qrs.average.toFixed(0)} <span className="text-xs">ms</span>
                                </div>
                                <div className="text-xs text-gray-500 mt-1">
                                    {analysisResults.intervals.qrs.status === 'normal' ? 'Normal' : 'Wide'}
                                </div>
                            </div>

                            <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-3">
                                <div className="text-gray-400 text-xs mb-1">QT Interval</div>
                                <div className="font-bold text-lg text-gray-200">
                                    {analysisResults.intervals.qt.average.toFixed(0)} <span className="text-xs">ms</span>
                                </div>
                                <div className="text-xs text-gray-500 mt-1">
                                    Raw measurement
                                </div>
                            </div>

                            {/* Enhanced Medical Disclaimer */}
                            <div className="bg-red-900/20 border col-span-2 border-red-500/20 rounded-lg p-2 mb-3">
                                <div className="text-sm text-red-300">
                                    ⚠️ <strong>Medical Disclaimer:</strong> This device is NOT a medical diagnostic tool and should NOT be used for diagnosis, treatment decisions,
                                    or medical emergencies. The AI analysis is based on pattern recognition and may not detect all conditions.
                                    Always consult qualified healthcare professionals for medical evaluation.
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}