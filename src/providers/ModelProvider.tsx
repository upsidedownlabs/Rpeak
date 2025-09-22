// src/providers/ModelProvider.tsx
"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import * as tf from '@tensorflow/tfjs';
import { classLabels } from '@/lib/modelTrainer'; // Use your actual class labels

type ModelContextType = {
  model: tf.LayersModel | null;
  isLoading: boolean;
  error: string | null;
  predict: (features: number[]) => Promise<{
    prediction: string;
    confidence: number;
    allProbabilities: Array<{label: string; probability: number}>;
  } | null>;
};

const ModelContext = createContext<ModelContextType | undefined>(undefined);

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

export function ModelProvider({ children }: { children: ReactNode }) {
  const [model, setModel] = useState<tf.LayersModel | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadModel() {
      try {
        await tf.ready();
        console.log('TensorFlow.js initialized');

        // Try localStorage first, then static path
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
            console.log(`Model loaded successfully from: ${modelUrl}`);
            break;
          } catch (err) {
            console.log(`Failed to load model from ${modelUrl}:`, err);
            continue;
          }
        }

        if (!loadedModel) {
          setError('No model found in browser storage or static assets. Please train or provide the model.');
          setIsLoading(false);
          return;
        }

        setModel(loadedModel);
        setIsLoading(false);
      } catch (err) {
        console.error('Failed to load model:', err);
        setError(err instanceof Error ? err.message : 'Failed to load model');
        setIsLoading(false);
      }
    }

    loadModel();
  }, []);

  // Function to make predictions
  const predict = async (features: number[]) => {
    if (!model) return null;

    try {
      if (features.length !== 720) {
        throw new Error('Input features must be an array of length 720');
      }

      const inputTensor = tf.tensor(features, [1, 720, 1]);
      const outputTensor = model.predict(inputTensor) as tf.Tensor;
      const probabilities = await outputTensor.data();

      const predictionArray = Array.from(probabilities);
      const maxProbIndex = predictionArray.indexOf(Math.max(...predictionArray));
      const predictedClass = classLabels[maxProbIndex];

      const result = {
        prediction: predictedClass,
        confidence: predictionArray[maxProbIndex] * 100,
        allProbabilities: classLabels.map((label, index) => ({
          label,
          probability: predictionArray[index] * 100
        })).sort((a, b) => b.probability - a.probability)
      };

      inputTensor.dispose();
      outputTensor.dispose();

      return result;
    } catch (err) {
      console.error('Prediction error:', err);
      return null;
    }
  };

  const value = { model, isLoading, error, predict };

  return (
    <ModelContext.Provider value={value}>
      {children}
    </ModelContext.Provider>
  );
}

// Custom hook to use the model
export function useModel() {
  const context = useContext(ModelContext);
  if (context === undefined) {
    throw new Error('useModel must be used within a ModelProvider');
  }
  return context;
}