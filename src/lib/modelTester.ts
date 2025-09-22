import * as tf from "@tensorflow/tfjs";
import { classLabels } from './modelTrainer';

// Check if model exists in localStorage
export async function checkModelExists(): Promise<boolean> {
  const models = await tf.io.listModels();
  return models['localstorage://beat-level-ecg-model'] !== undefined;
}

// Helper to get the correct model path for static serving (local/dev or GitHub Pages)
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

// Load model and make a test prediction
export async function testLoadModel() {
  try {
    // Try to load from localStorage first, then static path
    const modelSources = [
      'localstorage://beat-level-ecg-model',
      getModelPath(),
      'models/beat-level-ecg-model.json',
    ];

    let model: tf.LayersModel | null = null;
    for (const modelUrl of modelSources) {
      try {
        if (modelUrl.startsWith('localstorage://')) {
          const models = await tf.io.listModels();
          if (!models[modelUrl]) {
            continue;
          }
        }
        model = await tf.loadLayersModel(modelUrl);
        break;
      } catch {
        continue;
      }
    }

    if (!model) {
      throw new Error('No model found in local storage or static assets. Please train or provide the model.');
    }

    // Get input shape from model (should be [null, 187, 1])
    const inputShape = model.inputs[0].shape;
    const inputLength = inputShape[1] || 187;

    // Create test input (example: 187 features for beat-level model)
    const testInputArray = Array(inputLength).fill(0); // Replace with realistic test data if available
    const testInput = tf.tensor(testInputArray, [1, inputLength, 1]);

    // Run prediction
    const prediction = model.predict(testInput) as tf.Tensor;
    const probabilities = await prediction.data();

    // Get index of highest probability
    const maxProbIndex = Array.from(probabilities).indexOf(
      Math.max(...Array.from(probabilities))
    );

    // Get corresponding class label
    const predictedClass = classLabels[maxProbIndex];

    // Cleanup tensors
    testInput.dispose();
    prediction.dispose();

    return {
      success: true,
      prediction: predictedClass,
      probabilities: Array.from(probabilities).map((p, i) => ({
        class: classLabels[i],
        probability: p
      }))
    };
  } catch (error) {
    console.error('Model test failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}