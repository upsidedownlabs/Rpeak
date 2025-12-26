// src/lib/tfLoader.ts
/**
 * Lazy loader for TensorFlow.js - decouples TF from initial bundle
 * This dramatically improves LCP by deferring TF.js load until needed
 */

let tfModule: typeof import('@tensorflow/tfjs') | null = null;
let modelCache: any | null = null;
let loadingPromise: Promise<any> | null = null;
let modelLoadingPromise: Promise<any> | null = null;

/**
 * Dynamically imports TensorFlow.js (only once)
 */
export async function loadTensorFlow() {
  if (tfModule) return tfModule;
  
  if (loadingPromise) {
    await loadingPromise;
    return tfModule;
  }
  
  loadingPromise = import('@tensorflow/tfjs').then(async (tf) => {
    await tf.ready();
    console.log('TensorFlow.js loaded and initialized');
    tfModule = tf;
    return tf;
  });
  
  await loadingPromise;
  return tfModule;
}

/**
 * Gets the cached TensorFlow module (returns null if not loaded yet)
 */
export function getTensorFlow() {
  return tfModule;
}

/**
 * Loads the ECG model (lazy, with caching)
 */
export async function loadECGModel(): Promise<any> {
  if (modelCache) return modelCache;
  
  if (modelLoadingPromise) {
    await modelLoadingPromise;
    return modelCache;
  }
  
  modelLoadingPromise = (async () => {
    const tf = await loadTensorFlow();
    if (!tf) throw new Error('TensorFlow.js failed to load');
    
    try {
      // Determine correct model path
      const basePath = typeof window !== 'undefined' && window.location.pathname.startsWith('/Rpeak') 
        ? '/Rpeak/' 
        : '/';
      
      const modelPath = `${basePath}models/beat-level-ecg-model.json`;
      
      // Try localStorage first, then static path
      const modelSources = [
        'localstorage://beat-level-ecg-model',
        modelPath,
        'models/beat-level-ecg-model.json',
      ];

      let loadedModel: any = null;
      for (const modelUrl of modelSources) {
        try {
          if (modelUrl.startsWith('localstorage://')) {
            const models = await tf.io.listModels();
            if (!models[modelUrl]) continue;
          }
          loadedModel = await tf.loadLayersModel(modelUrl);
          console.log(`ECG model loaded successfully from: ${modelUrl}`);
          break;
        } catch (err) {
          console.log(`Failed to load model from ${modelUrl}:`, err);
          continue;
        }
      }

      if (!loadedModel) {
        throw new Error('Model not found in any source');
      }

      modelCache = loadedModel;
      return loadedModel;
    } catch (err) {
      console.error('Failed to load ECG model:', err);
      throw err;
    }
  })();
  
  await modelLoadingPromise;
  return modelCache;
}

/**
 * Gets the cached model (returns null if not loaded yet)
 */
export function getCachedModel() {
  return modelCache;
}

/**
 * Clears the cache (useful for testing/development)
 */
export function clearCache() {
  tfModule = null;
  modelCache = null;
  loadingPromise = null;
}
