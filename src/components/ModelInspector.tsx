"use client";

import React, { useState, useEffect } from 'react';
import * as tf from '@tensorflow/tfjs';
import { zscoreNorm, classLabels } from '../lib/modelTrainer';

const INPUT_LENGTH = 135; // Updated to match your model's input shape

function getModelPath(): string {
  if (typeof window !== "undefined") {
    const path = window.location.pathname;
    // Adjust 'Rpeak' to your actual repo name if different
    if (path.startsWith('/Rpeak')) {
      return '/Rpeak/models/beat-level-ecg-model.json';
    }
  }
  // Default for local/dev
  return 'models/beat-level-ecg-model.json';
}

export default function ModelInspector() {
  const [model, setModel] = useState<tf.LayersModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modelInfo, setModelInfo] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'structure' | 'weights' | 'test'>('structure');
  const [testInputText, setTestInputText] = useState<string>('');
  const [testInputs, setTestInputs] = useState<number[]>(Array.from({ length: INPUT_LENGTH }, () => Math.random() * 2 - 1));
  const [prediction, setPrediction] = useState<any>(null);

  // Load model on component mount
  useEffect(() => {
    async function loadModel() {
      setLoading(true);
      try {
        // Try localstorage first, then static path
        const modelSources = [
          'localstorage://beat-level-ecg-model',
          getModelPath(),
          'models/beat-level-ecg-model.json',
        ];

        let loadedModel: tf.LayersModel | null = null;
        for (const modelUrl of modelSources) {
          try {
            if (modelUrl.startsWith('localstorage://')) {
              const models = await tf.io.listModels();
              if (!models[modelUrl]) {
                continue;
              }
            }
            loadedModel = await tf.loadLayersModel(modelUrl);
            break;
          } catch {
            continue;
          }
        }

        if (!loadedModel) {
          setError('No model found in local storage or static assets. Please train or provide the model.');
          setLoading(false);
          return;
        }

        setModel(loadedModel);

        // Extract model info
        const layers = loadedModel.layers;
        const summary = layers.map(layer => {
          const config = layer.getConfig();
          const weights = layer.getWeights();
          const weightShapes = weights.map(w => w.shape);
          return {
            name: layer.name,
            type: layer.getClassName(),
            config,
            weightShapes,
            units: config.units,
            activation: config.activation
          };
        });

        setModelInfo({
          layers: summary,
          totalLayers: layers.length,
          inputShape: loadedModel.inputs[0].shape,
          outputShape: loadedModel.outputs[0].shape
        });

        setLoading(false);
      } catch (err) {
        console.error('Error loading model:', err);
        setError(err instanceof Error ? err.message : 'Failed to load model');
        setLoading(false);
      }
    }
    loadModel();
  }, []);

  // Handle textarea change
  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setTestInputText(e.target.value);
    const arr = e.target.value
      .split(',')
      .map(s => parseFloat(s.trim()))
      .filter(v => !isNaN(v));
    if (arr.length === INPUT_LENGTH) setTestInputs(arr);
  };

  // Generate random ECG-like data for testing
  const generateRandomECG = () => {
    const randomECG: number[] = [];
    for (let i = 0; i < INPUT_LENGTH; i++) {
      // Generate ECG-like pattern with some noise
      const t = i / INPUT_LENGTH;
      let value = 0;
      
      // QRS complex simulation around middle
      if (t > 0.4 && t < 0.6) {
        const qrsT = (t - 0.4) / 0.2; // Normalize to 0-1 for QRS region
        if (qrsT < 0.3) {
          value = -0.2 * Math.sin(qrsT * Math.PI / 0.3); // Q wave
        } else if (qrsT < 0.7) {
          value = 2.0 * Math.sin((qrsT - 0.3) * Math.PI / 0.4); // R wave
        } else {
          value = -0.5 * Math.sin((qrsT - 0.7) * Math.PI / 0.3); // S wave
        }
      } else {
        // Baseline with small variations
        value = 0.1 * Math.sin(t * 2 * Math.PI) + 0.05 * Math.sin(t * 8 * Math.PI);
      }
      
      // Add some noise
      value += (Math.random() - 0.5) * 0.1;
      randomECG.push(value);
    }
    
    const csvString = randomECG.join(',');
    setTestInputText(csvString);
    setTestInputs(randomECG);
  };

  // Make prediction with the model
  const handlePredict = async () => {
    if (!model) return;
    try {
      const normInputs = zscoreNorm(testInputs);
      const inputTensor = tf.tensor3d([normInputs.map(v => [v])], [1, INPUT_LENGTH, 1]);
      const outputTensor = model.predict(inputTensor) as tf.Tensor;
      const probabilities = await outputTensor.data();

      const predictionArray = Array.from(probabilities);
      const maxProbIndex = predictionArray.indexOf(Math.max(...predictionArray));
      const predictedClass = classLabels[maxProbIndex];

      const result = {
        prediction: predictedClass,
        confidence: predictionArray[maxProbIndex] * 100,
        allProbabilities: classLabels.map((label: string, index: number) => ({
          label,
          probability: predictionArray[index] * 100
        })).sort((a, b) => b.probability - a.probability)
      };

      setPrediction(result);

      inputTensor.dispose();
      outputTensor.dispose();
    } catch (err) {
      console.error('Prediction error:', err);
      setError(err instanceof Error ? err.message : 'Prediction failed');
    }
  };

  // Render loading state
  if (loading) {
    return (
      <div className="bg-black/40 backdrop-blur-sm border border-white/20 rounded-xl p-6 h-full">
        <h2 className="text-xl font-bold text-white mb-4">Model Inspector</h2>
        <div className="flex items-center justify-center p-8">
          <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mr-2"></div>
          <span className="text-blue-400">Loading model...</span>
        </div>
      </div>
    );
  }

  // Render error state
  if (error) {
    return (
      <div className="bg-black/40 backdrop-blur-sm border border-white/20 rounded-xl p-6 h-full">
        <h2 className="text-xl font-bold text-white mb-4">Model Inspector</h2>
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
          <span className="text-red-400">Error: {error}</span>
        </div>
      </div>
    );
  }

  // Render tabs and content
  return (
    <div className="bg-black/40 backdrop-blur-sm border border-white/20 rounded-xl p-6 h-full flex flex-col">
      <h2 className="text-xl font-bold text-white mb-4">Model Inspector</h2>

      {/* Tabs */}
      <div className="flex border-b border-white/20 mb-4">
        <button
          className={`px-4 py-2 font-medium ${activeTab === 'structure' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400'}`}
          onClick={() => setActiveTab('structure')}
        >
          Structure
        </button>
        <button
          className={`px-4 py-2 font-medium ${activeTab === 'weights' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400'}`}
          onClick={() => setActiveTab('weights')}
        >
          Weights
        </button>
        <button
          className={`px-4 py-2 font-medium ${activeTab === 'test' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400'}`}
          onClick={() => setActiveTab('test')}
        >
          Test Model
        </button>
      </div>

      {/* Tab Content */}
      <div className="overflow-y-auto flex-1 pr-2 scrollable-content h-full max-h-[80vh]">
        {/* Structure Tab */}
        {activeTab === 'structure' && modelInfo && (
          <div>
            <div className="mb-4 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
              <h3 className="text-blue-400 font-medium mb-2">Model Summary</h3>
              <div className="text-sm text-white">
                <p>Total Layers: {modelInfo.totalLayers}</p>
                <p>Input Shape: [{modelInfo.inputShape.slice(1).join(', ')}]</p>
                <p>Output Shape: [{modelInfo.outputShape.slice(1).join(', ')}]</p>
                <p>Classes: {classLabels.join(', ')}</p>
                <p>Beat Length: {INPUT_LENGTH} samples at 250Hz (≈0.376s)</p>
              </div>
            </div>
            <h3 className="text-white font-medium mb-2">Layers</h3>
            {modelInfo.layers.map((layer: any, index: number) => (
              <div key={index} className="mb-4 p-3 bg-black/20 border border-white/10 rounded-lg">
                <div className="flex justify-between">
                  <span className="text-white">{layer.name}</span>
                  <span className="text-gray-400 text-sm">{layer.type}</span>
                </div>
                <div className="mt-2 text-sm">
                  {layer.units !== undefined && (
                    <p className="text-gray-300">Units: {layer.units}</p>
                  )}
                  {layer.activation && (
                    <p className="text-gray-300">Activation: {layer.activation}</p>
                  )}
                  <p className="text-gray-300">
                    Weight Shapes: {layer.weightShapes.map((shape: number[]) =>
                      `[${shape.join(', ')}]`
                    ).join(', ')}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Weights Tab */}
        {activeTab === 'weights' && model && (
          <div>
            <div className="mb-4 p-3 bg-purple-500/10 border border-purple-500/30 rounded-lg">
              <h3 className="text-purple-400 font-medium mb-2">Weight Visualization</h3>
              <p className="text-sm text-white">
                This section shows the distribution of weights in each layer of the model.
              </p>
            </div>
            {model.layers.map((layer, index) => {
              const weights = layer.getWeights();
              if (weights.length === 0) return null;
              return (
                <div key={index} className="mb-4 p-3 bg-black/20 border border-white/10 rounded-lg">
                  <h4 className="text-white mb-2">{layer.name}</h4>
                  {weights.map((weight, wIndex) => {
                    const data = weight.dataSync();
                    const min = Math.min(...Array.from(data));
                    const max = Math.max(...Array.from(data));
                    const avg = Array.from(data).reduce((a, b) => a + b, 0) / data.length;
                    return (
                      <div key={wIndex} className="mb-3">
                        <p className="text-sm text-gray-400">
                          {wIndex === 0 ? 'Weights' : 'Biases'} [{weight.shape.join('×')}]
                        </p>
                        <div className="grid grid-cols-3 gap-2 mt-1 text-xs">
                          <div className="p-1 bg-black/30 rounded">
                            <span className="text-blue-400">Min: {min.toFixed(4)}</span>
                          </div>
                          <div className="p-1 bg-black/30 rounded">
                            <span className="text-green-400">Avg: {avg.toFixed(4)}</span>
                          </div>
                          <div className="p-1 bg-black/30 rounded">
                            <span className="text-red-400">Max: {max.toFixed(4)}</span>
                          </div>
                        </div>
                        {/* Simple histogram (10 buckets) */}
                        {data.length > 0 && (
                          <div className="mt-2 h-10 flex items-end">
                            {Array.from({ length: 10 }).map((_, i) => {
                              const bucketMin = min + (max - min) * (i / 10);
                              const bucketMax = min + (max - min) * ((i + 1) / 10);
                              const bucketCount = Array.from(data).filter(
                                v => v >= bucketMin && v < bucketMax
                              ).length;
                              const height = `${Math.max(5, (bucketCount / data.length) * 100)}%`;
                              return (
                                <div
                                  key={i}
                                  className="flex-1 mx-px"
                                  style={{
                                    height,
                                    backgroundColor: `rgba(59, 130, 246, ${0.3 + (i / 10) * 0.7})`
                                  }}
                                  title={`${bucketCount} values between ${bucketMin.toFixed(4)} and ${bucketMax.toFixed(4)}`}
                                />
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}

        {/* Test Tab */}
        {activeTab === 'test' && (
          <div>
            <div className="mb-4 p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
              <h3 className="text-green-400 font-medium mb-2">Test Model</h3>
              <p className="text-sm text-white">
                Paste {INPUT_LENGTH} comma-separated ECG values below and click &quot;Predict&quot; to test the model.
                The model expects ECG beats of 94 samples at 250Hz (≈0.376 seconds).
              </p>
            </div>
            <textarea
              value={testInputText}
              onChange={handleTextChange}
              rows={6}
              className="w-full bg-black/30 text-white border border-white/20 rounded px-3 py-2 mb-4"
              placeholder={`e.g. 0.12,0.15,0.13,... (${INPUT_LENGTH} values)`}
            />
            <div className="flex gap-3 mb-6">
              <button
                onClick={handlePredict}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg"
                disabled={testInputs.length !== INPUT_LENGTH}
              >
                Predict
              </button>
              <button
                onClick={generateRandomECG}
                className="px-6 py-2 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-lg"
              >
                Generate ECG
              </button>
              <button
                onClick={() => { setTestInputText(''); setTestInputs(Array.from({ length: INPUT_LENGTH }, () => Math.random() * 2 - 1)); setPrediction(null); }}
                className="px-6 py-2 bg-gray-700 hover:bg-gray-800 text-white font-medium rounded-lg"
              >
                Reset
              </button>
            </div>
            {/* Input validation status */}
            <div className="mb-4 p-2 bg-black/20 border border-white/10 rounded">
              <span className={`text-sm ${testInputs.length === INPUT_LENGTH ? 'text-green-400' : 'text-yellow-400'}`}>
                Current input length: {testInputs.length}/{INPUT_LENGTH}
                {testInputs.length !== INPUT_LENGTH && ' (Please provide exactly ' + INPUT_LENGTH + ' values)'}
              </span>
            </div>
            {/* Prediction Results */}
            {prediction && (
              <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
                <h3 className="text-green-400 font-medium mb-3">Prediction Results</h3>
                <div className="mb-4 text-center">
                  <div className="text-3xl font-bold text-white mb-1">
                    {prediction.prediction}
                  </div>
                  <div className="text-green-400">
                    {prediction.confidence.toFixed(2)}% confidence
                  </div>
                </div>
                <div className="space-y-2">
                  {prediction.allProbabilities.map((item: any, index: number) => (
                    <div key={index} className="flex items-center">
                      <div className="w-32 text-sm text-white">{item.label}</div>
                      <div className="flex-1 h-5 bg-black/40 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${item.probability}%`,
                            backgroundColor: getColorForProbability(item.probability)
                          }}
                        />
                      </div>
                      <div className="w-16 text-right text-sm text-white ml-2">
                        {item.probability.toFixed(1)}%
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function getColorForProbability(probability: number): string {
  if (probability > 80) return "#22c55e";
  if (probability > 60) return "#4ade80";
  if (probability > 40) return "#facc15";
  if (probability > 20) return "#f59e42";
  return "#ef4444";
}