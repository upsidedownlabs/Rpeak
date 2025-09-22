"use client";

import React, { useState, useEffect, useRef } from 'react';
import { trainBeatLevelECGModelAllFiles, classLabels, allFilePairs } from '@/lib/modelTrainer';
import { checkModelExists } from '../../lib/modelTester';
import ModelInspector from '../../components/ModelInspector';
import NavBar from '../../components/NavBar';

export default function TrainPage() {
  const [isTraining, setIsTraining] = useState(false);
  const [trainingComplete, setTrainingComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelExists, setModelExists] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    checkModelExists().then(setModelExists);
  }, []);

  // Scroll to bottom of logs when logs update
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const appendLog = (msg: string) => setLogs(logs => [...logs, msg]);

  const handleTrain = async () => {
    setIsTraining(true);
    setError(null);
    setTrainingComplete(false);
    setLogs([]);

    try {
      appendLog("🚀 Starting training with updated 360Hz AAMI-5 model...");
      appendLog(`📊 Using ${allFilePairs.length} MIT-BIH records for comprehensive training`);
      appendLog("🔧 Model Configuration: 135 samples @ 360Hz (375ms beat windows)");
      
      await trainBeatLevelECGModelAllFiles(
        // onEpoch callback
        (epoch, logsObj) => {
          const trainAcc = (logsObj?.acc || logsObj?.categoricalAccuracy || 0) * 100;
          const valAcc = (logsObj?.val_acc || logsObj?.val_categoricalAccuracy || 0) * 100;
          const trainLoss = logsObj?.loss?.toFixed(4);
          const valLoss = logsObj?.val_loss?.toFixed(4);
          appendLog(
            `📈 Epoch ${epoch + 1}/10 | Train Acc: ${trainAcc.toFixed(2)}% | Val Acc: ${valAcc.toFixed(2)}% | Train Loss: ${trainLoss} | Val Loss: ${valLoss}`
          );
        },
        // onLog callback
        appendLog
      );
      appendLog("✅ Training completed successfully with 360Hz model!");
      appendLog("📁 Model saved to browser downloads as 'beat-level-ecg-model'");
      appendLog("🎯 Model ready for real-time ECG beat classification");
      setTrainingComplete(true);
      setModelExists(true);
    } catch (err) {
      appendLog(`❌ Training failed: ${err instanceof Error ? err.message : 'Training failed'}`);
      setError(err instanceof Error ? err.message : 'Training failed');
    } finally {
      setIsTraining(false);
    }
  };

  // Updated constants for 360Hz model
  const samplingRate = 360; // Native 360Hz sampling rate
  const beatLength = 135; // 135 samples for 375ms at 360Hz
  const beatDurationMs = (beatLength / samplingRate * 1000).toFixed(0);

  return (
    <div className="w-full min-h-screen h-full bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 overflow-auto flex flex-col">
      <NavBar />
      <div className="flex-1 flex flex-col pt-16">
        <div className="max-w-9xl mx-auto p-4 flex-1 w-full">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 h-full">
            {/* Training Panel */}
            <div className="bg-black/40 backdrop-blur-sm border border-white/20 rounded-xl p-3 flex flex-col h-[540px] md:h-[calc(100vh-7.5rem)]">
              <h2 className="text-lg font-bold text-white mb-2">ECG Beat Classification Model Training</h2>
              <div className="mb-2 flex-1 overflow-y-auto">
                <p className="text-white mb-2 text-sm">
                  Train an advanced deep learning model for ECG heartbeat classification using the AAMI 5-class standard with optimized 360Hz sampling for real-time arrhythmia detection.
                </p>
                
                {/* Updated Model Specifications */}
                <div className="mb-2 text-xs text-blue-300 bg-blue-500/10 border border-blue-500/20 rounded-lg p-2">
                  <h4 className="font-bold text-blue-200 mb-1">Model Specifications (Updated):</h4>
                  <p>• <b>Sampling Rate:</b> {samplingRate} Hz (native 360Hz - no resampling)</p>
                  <p>• <b>Beat Window:</b> {beatLength} samples ({beatDurationMs}ms duration)</p>
                  <p>• <b>Input Shape:</b> [{beatLength}, 1] tensor for CNN processing</p>
                  <p>• <b>AAMI Classes:</b> {classLabels.join(', ')}</p>
                  <p>• <b>Architecture:</b> 4-layer CNN + GAP + 2 dense layers</p>
                  <p>• <b>Training Data:</b> {allFilePairs.length} MIT-BIH patient records</p>
                </div>

                {/* Model Status */}
                {modelExists && (
                  <div className="p-2 bg-green-500/10 border border-green-500/30 rounded-lg mb-2">
                    <div className="flex items-center">
                      <div className="w-2 h-2 bg-green-400 rounded-full mr-2"></div>
                      <span className="text-green-400 font-medium text-xs">360Hz AAMI-5 model trained and ready</span>
                    </div>
                  </div>
                )}

                {/* Training Details */}
                <div className="space-y-1 text-xs text-gray-300 mb-2 bg-slate-800/30 border border-slate-700/50 rounded-lg p-2">
                  <h4 className="font-bold text-gray-200 mb-1">Training Details:</h4>
                  <p>• Processes ~100,000+ labeled heartbeat examples</p>
                  <p>• Balanced dataset with equal AAMI class representation</p>
                  <p>• Z-score normalized 375ms beat windows</p>
                  <p>• 70/15/15% train/validation/test data split</p>
                  <p>• Adaptive learning rate with batch normalization</p>
                  <p>• Model saved locally in browser IndexedDB storage</p>
                </div>

                {/* Beat Classification Mapping */}
                <div className="space-y-1 text-xs text-gray-300 mb-2 bg-purple-500/10 border border-purple-500/20 rounded-lg p-2">
                  <h4 className="font-bold text-purple-200 mb-1">AAMI Beat Classification:</h4>
                  <p>• <span className="text-green-400">Normal:</span> N, L, R, e, j (sinus beats)</p>
                  <p>• <span className="text-yellow-400">Supraventricular:</span> A, a, J, S (atrial)</p>
                  <p>• <span className="text-red-400">Ventricular:</span> V, E, r (PVCs)</p>
                  <p>• <span className="text-purple-400">Fusion:</span> F (mixed beats)</p>
                  <p>• <span className="text-gray-400">Other:</span> Q, /, f, n (artifacts)</p>
                </div>
              </div>

              <button
                onClick={handleTrain}
                disabled={isTraining}
                className={`w-full py-2 px-3 rounded-lg font-medium flex items-center justify-center text-sm ${
                  isTraining
                    ? 'bg-blue-500/30 text-blue-300 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
              >
                {isTraining ? (
                  <>
                    <div className="w-4 h-4 border-2 border-blue-300 border-t-transparent rounded-full animate-spin mr-2"></div>
                    Training 360Hz Model...
                  </>
                ) : (
                  modelExists ? 'Retrain 360Hz AAMI-5 Model' : 'Train New 360Hz AAMI-5 Model'
                )}
              </button>

              {trainingComplete && (
                <div className="mt-2 p-2 bg-green-500/10 border border-green-500/30 rounded-lg text-xs">
                  <span className="text-green-400">✓ 360Hz AAMI-5 model training completed successfully!</span>
                </div>
              )}
              {error && (
                <div className="mt-2 p-2 bg-red-500/10 border border-red-500/30 rounded-lg text-xs">
                  <span className="text-red-400">Error: {error}</span>
                </div>
              )}
            </div>

            {/* Training Logs */}
            <div className="bg-black/40 backdrop-blur-sm border border-white/20 rounded-xl p-3 flex flex-col h-[540px] md:h-[calc(100vh-7.5rem)]">
              <h3 className="text-lg font-bold text-white mb-2">Training Progress & Logs</h3>
              <div className="bg-black/60 border border-white/10 rounded p-2 h-28 md:h-40 overflow-y-auto text-xs text-gray-200 font-mono whitespace-pre-line flex-1">
                {logs.length === 0 && !isTraining && (
                  <div className="text-gray-500 italic">Training logs will appear here when training starts...</div>
                )}
                {logs.map((log, idx) => (
                  <div key={idx} className={
                    log.includes('✅') ? 'text-green-400' :
                    log.includes('❌') ? 'text-red-400' :
                    log.includes('⚠️') ? 'text-yellow-400' :
                    log.includes('📈') || log.includes('Epoch') ? 'text-blue-300' :
                    log.includes('🚀') || log.includes('🔧') ? 'text-purple-300' :
                    log.includes('📊') || log.includes('📁') ? 'text-cyan-300' :
                    'text-gray-200'
                  }>{log}</div>
                ))}
                <div ref={logsEndRef} />
              </div>

              {/* Updated Training Process */}
              <div className="mt-2">
                <h3 className="text-lg font-bold text-white mb-2">Training Process (360Hz AAMI-5)</h3>
                <ol className="list-decimal list-inside space-y-1 text-xs text-gray-300">
                  <li>Load {allFilePairs.length} MIT-BIH ECG records at native 360Hz</li>
                  <li>Extract {beatLength}-sample beat windows around R-peaks ({beatDurationMs}ms)</li>
                  <li>Map beat annotations to AAMI 5-class standard</li>
                  <li>Apply Z-score normalization for training stability</li>
                  <li>Balance dataset across all 5 AAMI arrhythmia classes</li>
                  <li>Train optimized CNN model for 10 epochs with validation</li>
                  <li>Evaluate performance with class-specific metrics</li>
                  <li>Save trained model to browser IndexedDB storage</li>
                </ol>
                
                <div className="mt-2 p-2 bg-gray-800/30 border border-gray-700/50 rounded text-xs">
                  <p className="text-gray-400">
                    <strong>Note:</strong> This updated model uses native 360Hz sampling with 135-sample windows, 
                    optimized for real-time ECG analysis with improved accuracy for arrhythmia detection.
                  </p>
                </div>
              </div>
            </div>

            {/* Model Inspector */}
            <div className="bg-black/40 backdrop-blur-sm border border-white/20 rounded-xl p-3 h-[540px] md:h-[calc(100vh-7.5rem)] overflow-auto flex flex-col">
              <ModelInspector />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

