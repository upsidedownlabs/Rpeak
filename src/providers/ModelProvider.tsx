// src/providers/ModelProvider.tsx
"use client";

import { createContext, useContext, useState, ReactNode, useCallback } from 'react';
import { loadECGModel, loadTensorFlow, getCachedModel } from '@/lib/tfLoader';
import { classLabels } from '@/lib/modelTrainer'; // Use your actual class labels

type ModelContextType = {
  model: any | null;
  isLoading: boolean;
  error: string | null;
  loadModel: () => Promise<void>;
  predict: (features: number[]) => Promise<{
    prediction: string;
    confidence: number;
    allProbabilities: Array<{label: string; probability: number}>;
  } | null>;
};

const ModelContext = createContext<ModelContextType | undefined>(undefined);

export function ModelProvider({ children }: { children: ReactNode }) {
  const [model, setModel] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lazy load model on-demand
  const loadModel = useCallback(async () => {
    // Check if already loaded
    const cached = getCachedModel();
    if (cached) {
      setModel(cached);
      return;
    }

    if (isLoading) return; // Prevent duplicate loads

    setIsLoading(true);
    setError(null);

    try {
      const loadedModel = await loadECGModel();
      setModel(loadedModel);
      console.log('ECG model loaded via lazy loading');
    } catch (err) {
      console.error('Failed to load model:', err);
      setError(err instanceof Error ? err.message : 'Failed to load model');
    } finally {
      setIsLoading(false);
    }
  }, [isLoading]);

  // Function to make predictions
  const predict = useCallback(async (features: number[]) => {
    if (!model) return null;

    try {
      // Load TensorFlow dynamically for tensor operations
      const tf = await loadTensorFlow();
      if (!tf) return null;

      if (features.length !== 720) {
        throw new Error('Input features must be an array of length 720');
      }

      const inputTensor = tf.tensor(features, [1, 720, 1]);
      const outputTensor = model.predict(inputTensor) as any;
      const probabilities = await outputTensor.data();

      const predictionArray = Array.from(probabilities) as number[];
      const maxProbIndex = predictionArray.indexOf(Math.max(...predictionArray));
      const predictedClass = classLabels[maxProbIndex];

      const result = {
        prediction: predictedClass,
        confidence: predictionArray[maxProbIndex] * 100,
        allProbabilities: classLabels.map((label, index) => ({
          label,
          probability: (predictionArray[index] as number) * 100
        })).sort((a, b) => b.probability - a.probability)
      };

      inputTensor.dispose();
      outputTensor.dispose();

      return result;
    } catch (err) {
      console.error('Prediction error:', err);
      return null;
    }
  }, [model]);

  const value = { model, isLoading, error, loadModel, predict };

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