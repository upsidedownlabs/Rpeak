import * as tf from "@tensorflow/tfjs";
import Papa from "papaparse";
import { Highpass, Notch, Lowpass } from "./filters";

// --- 1. Map MIT-BIH annotation symbols to AAMI 5-class standard ---
export const AAMI_CLASSES = ["Normal", "Supraventricular", "Ventricular", "Fusion", "Other"];

export const classLabels = AAMI_CLASSES;

export function mapAnnotationToAAMI(symbol: string): string | null {
  if (['N', '.', 'L', 'R', 'e', 'j'].includes(symbol)) return 'Normal';
  if (['A', 'a', 'J', 'S'].includes(symbol)) return 'Supraventricular';
  if (['V', 'E', 'r'].includes(symbol)) return 'Ventricular';
  if (['F'].includes(symbol)) return 'Fusion';
  if (['Q', '/', 'f', 'n'].includes(symbol)) return 'Other';
  return null;
}

export async function loadBeatLevelData(
  ecgPath: string,
  annPath: string,
  beatLength = 135, // Increased for 360Hz: 135 samples ≈ 375ms at 360Hz
  originalRate = 360,
  targetRate = 360  // Keep original rate - no resampling
) {


  // Load ECG CSV (MLII lead)
  const ecgSignal: number[] = await new Promise((resolve, reject) => {
    Papa.parse(ecgPath, {
      download: true,
      header: false,
      complete: (results) => {
      
        
        const signal = results.data
          .map((row) => {
            const val = Number((row as [string, string])[1]);
            return val;
          })
          .filter((v: number) => !isNaN(v));
        
      
        resolve(signal);
      },
      error: (err) => {
       
        reject(err);
      }
    });
  });

  // Initialize filters
const hp = new Highpass();
const notch = new Notch();
const lp = new Lowpass();

// Apply filters in sequence to the ECG signal
const filteredECG = ecgSignal.map(sample => {
    let x = hp.process(sample);
    x = notch.process(x);
    x = lp.process(x);
    return x;
});

// Use filteredECG for all downstream processing
const finalECG = filteredECG;

  // Load annotation CSV (index, annotation_symbol)
  const annotations: { index: number, annotation_symbol: string }[] = await new Promise((resolve, reject) => {
    Papa.parse(annPath, {
      download: true,
      header: true,
      complete: (results) => {
          
        const anns = results.data
          .map((row) => {
            const r = row as { index: string; annotation_symbol: string };
            const idx = Number(r.index);
            return {
              index: idx,
              annotation_symbol: r.annotation_symbol
            };
          })
          .filter((ann: { index: number; annotation_symbol: string }) => {
            const valid = !isNaN(ann.index) && ann.annotation_symbol;
            
            return valid;
          });
        
       
        resolve(anns);
      },
      error: (err) => {
        console.error(`Annotation parse error:`, err);
        reject(err);
      }
    });
  });

  // No resampling - use original ECG signal and annotations directly
  const finalAnnotations = annotations.filter(ann => {
    const valid = ann.index >= 0 && ann.index < finalECG.length;
    
    return valid;
  });
  
  
  // Extract beats around R-peaks
  const beats: number[][] = [];
  const labels: string[] = [];
  const halfBeat = Math.floor(beatLength / 2); // 67 samples for 135-sample beats
  
  

  let validBeats = 0;
  let invalidMapping = 0;
  let invalidBounds = 0;
  let invalidLength = 0;
  let invalidStd = 0;

  finalAnnotations.forEach((ann, idx) => {
    const mappedClass = mapAnnotationToAAMI(ann.annotation_symbol);
    if (!mappedClass) {
      invalidMapping++;
     
      return;
    }
    
    const startIdx = ann.index - halfBeat;
    const endIdx = ann.index + halfBeat + (beatLength % 2); // For odd beatLength
    
    if (startIdx < 0 || endIdx > finalECG.length) {
      invalidBounds++;
      
      return;
    }
    
    const beat = finalECG.slice(startIdx, endIdx);
    if (beat.length !== beatLength) {
      invalidLength++;
     
      return;
    }
    
    // Z-score normalization
    const mean = beat.reduce((a, b) => a + b, 0) / beat.length;
    const std = Math.sqrt(beat.reduce((a, b) => a + (b - mean) ** 2, 0) / beat.length);
    if (std <= 0.001) {
      invalidStd++;
      
      return;
    }
    
    beats.push(beat.map(x => (x - mean) / std));
    labels.push(mappedClass);
    validBeats++;
  });

  return { beats, labels };
}

// --- 3. Balance classes for training ---
export function prepareBalancedBeatDataset(beats: number[][], labels: string[]) {
  const classData: Record<string, number[][]> = {};
  beats.forEach((beat, idx) => {
    const label = labels[idx];
    if (!classData[label]) classData[label] = [];
    classData[label].push(beat);
  });
  const classes = Object.keys(classData);
  const minSize = Math.min(...classes.map(cls => classData[cls].length));
  const targetSize = Math.max(500, minSize);

  const balancedBeats: number[][] = [];
  const balancedLabels: string[] = [];
  classes.forEach(cls => {
    const classBeats = classData[cls];
    for (let i = 0; i < targetSize; i++) {
      balancedBeats.push(classBeats[i % classBeats.length]);
      balancedLabels.push(cls);
    }
  });

  // Shuffle
  for (let i = balancedBeats.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [balancedBeats[i], balancedBeats[j]] = [balancedBeats[j], balancedBeats[i]];
    [balancedLabels[i], balancedLabels[j]] = [balancedLabels[j], balancedLabels[i]];
  }

  return { beats: balancedBeats, labels: balancedLabels, classes };
}

// --- 4. Build optimized CNN model for beat-level classification (updated for 360Hz) ---
export function buildBeatLevelModel(inputLength: number, numClasses: number): tf.LayersModel {
  const model = tf.sequential();
  
  // Adjusted for longer input (135 samples vs 94) and higher resolution
  model.add(tf.layers.conv1d({ 
    inputShape: [inputLength, 1], 
    filters: 32, 
    kernelSize: 7,  // Increased kernel size for 360Hz
    activation: 'relu', 
    padding: 'same', 
    kernelInitializer: 'glorotNormal' 
  }));
  model.add(tf.layers.batchNormalization());
  model.add(tf.layers.maxPooling1d({ poolSize: 2 }));
  model.add(tf.layers.dropout({ rate: 0.2 }));

  model.add(tf.layers.conv1d({ 
    filters: 64, 
    kernelSize: 7,  // Increased kernel size
    activation: 'relu', 
    padding: 'same', 
    kernelInitializer: 'glorotNormal' 
  }));
  model.add(tf.layers.batchNormalization());
  model.add(tf.layers.maxPooling1d({ poolSize: 2 }));
  model.add(tf.layers.dropout({ rate: 0.2 }));

  model.add(tf.layers.conv1d({ 
    filters: 128, 
    kernelSize: 5,  // Increased kernel size
    activation: 'relu', 
    padding: 'same', 
    kernelInitializer: 'glorotNormal' 
  }));
  model.add(tf.layers.batchNormalization());
  model.add(tf.layers.maxPooling1d({ poolSize: 2 }));
  model.add(tf.layers.dropout({ rate: 0.3 }));

  model.add(tf.layers.conv1d({ 
    filters: 256, 
    kernelSize: 3, 
    activation: 'relu', 
    padding: 'same', 
    kernelInitializer: 'glorotNormal' 
  }));
  model.add(tf.layers.batchNormalization());
  model.add(tf.layers.globalAveragePooling1d());

  model.add(tf.layers.dense({ 
    units: 128, 
    activation: 'relu', 
    kernelRegularizer: tf.regularizers.l2({ l2: 0.01 }), 
    kernelInitializer: 'glorotNormal' 
  }));
  model.add(tf.layers.dropout({ rate: 0.5 }));

  model.add(tf.layers.dense({ 
    units: 64, 
    activation: 'relu', 
    kernelRegularizer: tf.regularizers.l2({ l2: 0.01 }), 
    kernelInitializer: 'glorotNormal' 
  }));
  model.add(tf.layers.dropout({ rate: 0.3 }));

  model.add(tf.layers.dense({ 
    units: numClasses, 
    activation: 'softmax', 
    kernelInitializer: 'glorotNormal' 
  }));

  model.compile({
    optimizer: tf.train.adam(0.001),
    loss: 'categoricalCrossentropy',
    metrics: ['categoricalAccuracy']
  });

  return model;
}

// --- 5. Utility: Convert beats/labels to tensors for training ---
export function beatsToTensors(beats: number[][], labels: string[], classes: string[]) {
  const X = tf.tensor3d(beats.map(beat => beat.map(val => [val])));
  const classMap = classes.reduce((map, cls, idx) => ({ ...map, [cls]: idx }), {} as Record<string, number>);
  const y = tf.oneHot(tf.tensor1d(labels.map(label => classMap[label]), 'int32'), classes.length);
  return { X, y, classMap };
}

// --- Utility: Z-score normalization for a beat or window ---
export function zscoreNorm(arr: number[]): number[] {
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const std = Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length);
  return std > 0.001 ? arr.map(x => (x - mean) / std) : arr.map(() => 0);
}

// --- 6. Example: Train beat-level model (call from React page) ---
export async function trainBeatLevelECGModel(ecgPath: string, annPath: string, onEpoch?: (epoch: number, logs: tf.Logs) => void) {
  const { beats, labels } = await loadBeatLevelData(ecgPath, annPath, 135, 360, 360); // Updated parameters
  const { beats: balancedBeats, labels: balancedLabels, classes } = prepareBalancedBeatDataset(beats, labels);
  const { X, y } = beatsToTensors(balancedBeats, balancedLabels, classes);

  // Split data
  const totalSamples = balancedBeats.length;
  const trainSize = Math.floor(totalSamples * 0.7);
  const valSize = Math.floor(totalSamples * 0.15);
  const [xTrain, xRest] = tf.split(X, [trainSize, totalSamples - trainSize]);
  const [yTrain, yRest] = tf.split(y, [trainSize, totalSamples - trainSize]);
  const [xVal, xTest] = tf.split(xRest, [valSize, totalSamples - trainSize - valSize]);
  const [yVal, yTest] = tf.split(yRest, [valSize, totalSamples - trainSize - valSize]);

  const model = buildBeatLevelModel(135, classes.length); // Updated input length

  await model.fit(xTrain, yTrain, {
    epochs: 10,
    batchSize: 32,
    validationData: [xVal, yVal],
    shuffle: true,
    callbacks: {
      onEpochEnd: async (epoch, logs) => {
        if (onEpoch) onEpoch(epoch, logs ?? {} as tf.Logs);
      }
    }
  });

  await model.save('downloads://beat-level-ecg-model');
  X.dispose(); y.dispose(); xTrain.dispose(); yTrain.dispose(); xVal.dispose(); yVal.dispose(); xTest.dispose(); yTest.dispose();
  return model;
}

// Dynamically determine base path for static assets
function getBasePath() {
  if (typeof window !== "undefined") {
    // If running on GitHub Pages, served from /Rpeak/
    if (window.location.pathname.startsWith("/Rpeak")) {
      return "/Rpeak";
    }
  }
  return "";
}

const BASE_PATH = getBasePath();

export const allFilePairs = [
  { ecg: `${BASE_PATH}/100_ekg.csv`, ann: `${BASE_PATH}/100_annotations_1.csv` },
  { ecg: `${BASE_PATH}/101_ekg.csv`, ann: `${BASE_PATH}/101_annotations_1.csv` },
  { ecg: `${BASE_PATH}/102_ekg.csv`, ann: `${BASE_PATH}/102_annotations_1.csv` },
  { ecg: `${BASE_PATH}/103_ekg.csv`, ann: `${BASE_PATH}/103_annotations_1.csv` },
  { ecg: `${BASE_PATH}/104_ekg.csv`, ann: `${BASE_PATH}/104_annotations_1.csv` },
  { ecg: `${BASE_PATH}/105_ekg.csv`, ann: `${BASE_PATH}/105_annotations_1.csv` },
  { ecg: `${BASE_PATH}/106_ekg.csv`, ann: `${BASE_PATH}/106_annotations_1.csv` },
  { ecg: `${BASE_PATH}/107_ekg.csv`, ann: `${BASE_PATH}/107_annotations_1.csv` },
  { ecg: `${BASE_PATH}/108_ekg.csv`, ann: `${BASE_PATH}/108_annotations_1.csv` },
  { ecg: `${BASE_PATH}/109_ekg.csv`, ann: `${BASE_PATH}/109_annotations_1.csv` },
  { ecg: `${BASE_PATH}/111_ekg.csv`, ann: `${BASE_PATH}/111_annotations_1.csv` },
  { ecg: `${BASE_PATH}/112_ekg.csv`, ann: `${BASE_PATH}/112_annotations_1.csv` },
  { ecg: `${BASE_PATH}/113_ekg.csv`, ann: `${BASE_PATH}/113_annotations_1.csv` },
  { ecg: `${BASE_PATH}/114_ekg.csv`, ann: `${BASE_PATH}/114_annotations_1.csv` },
  { ecg: `${BASE_PATH}/115_ekg.csv`, ann: `${BASE_PATH}/115_annotations_1.csv` },
  { ecg: `${BASE_PATH}/116_ekg.csv`, ann: `${BASE_PATH}/116_annotations_1.csv` },
  { ecg: `${BASE_PATH}/117_ekg.csv`, ann: `${BASE_PATH}/117_annotations_1.csv` },
  { ecg: `${BASE_PATH}/118_ekg.csv`, ann: `${BASE_PATH}/118_annotations_1.csv` },
  { ecg: `${BASE_PATH}/119_ekg.csv`, ann: `${BASE_PATH}/119_annotations_1.csv` },
  { ecg: `${BASE_PATH}/121_ekg.csv`, ann: `${BASE_PATH}/121_annotations_1.csv` },
  { ecg: `${BASE_PATH}/122_ekg.csv`, ann: `${BASE_PATH}/122_annotations_1.csv` },
  { ecg: `${BASE_PATH}/123_ekg.csv`, ann: `${BASE_PATH}/123_annotations_1.csv` },
  { ecg: `${BASE_PATH}/124_ekg.csv`, ann: `${BASE_PATH}/124_annotations_1.csv` },
  { ecg: `${BASE_PATH}/200_ekg.csv`, ann: `${BASE_PATH}/200_annotations_1.csv` },
  { ecg: `${BASE_PATH}/201_ekg.csv`, ann: `${BASE_PATH}/201_annotations_1.csv` },
  { ecg: `${BASE_PATH}/202_ekg.csv`, ann: `${BASE_PATH}/202_annotations_1.csv` },
  { ecg: `${BASE_PATH}/203_ekg.csv`, ann: `${BASE_PATH}/203_annotations_1.csv` },
  { ecg: `${BASE_PATH}/205_ekg.csv`, ann: `${BASE_PATH}/205_annotations_1.csv` },
  { ecg: `${BASE_PATH}/207_ekg.csv`, ann: `${BASE_PATH}/207_annotations_1.csv` },
  { ecg: `${BASE_PATH}/208_ekg.csv`, ann: `${BASE_PATH}/208_annotations_1.csv` },
  { ecg: `${BASE_PATH}/209_ekg.csv`, ann: `${BASE_PATH}/209_annotations_1.csv` },
  { ecg: `${BASE_PATH}/210_ekg.csv`, ann: `${BASE_PATH}/210_annotations_1.csv` },
  { ecg: `${BASE_PATH}/212_ekg.csv`, ann: `${BASE_PATH}/212_annotations_1.csv` },
  { ecg: `${BASE_PATH}/213_ekg.csv`, ann: `${BASE_PATH}/213_annotations_1.csv` },
  { ecg: `${BASE_PATH}/214_ekg.csv`, ann: `${BASE_PATH}/214_annotations_1.csv` },
  { ecg: `${BASE_PATH}/215_ekg.csv`, ann: `${BASE_PATH}/215_annotations_1.csv` },
  { ecg: `${BASE_PATH}/217_ekg.csv`, ann: `${BASE_PATH}/217_annotations_1.csv` },
  { ecg: `${BASE_PATH}/219_ekg.csv`, ann: `${BASE_PATH}/219_annotations_1.csv` },
  { ecg: `${BASE_PATH}/220_ekg.csv`, ann: `${BASE_PATH}/220_annotations_1.csv` },
  { ecg: `${BASE_PATH}/221_ekg.csv`, ann: `${BASE_PATH}/221_annotations_1.csv` },
  { ecg: `${BASE_PATH}/222_ekg.csv`, ann: `${BASE_PATH}/222_annotations_1.csv` },
  { ecg: `${BASE_PATH}/223_ekg.csv`, ann: `${BASE_PATH}/223_annotations_1.csv` },
  { ecg: `${BASE_PATH}/228_ekg.csv`, ann: `${BASE_PATH}/228_annotations_1.csv` },
  { ecg: `${BASE_PATH}/230_ekg.csv`, ann: `${BASE_PATH}/230_annotations_1.csv` },
  { ecg: `${BASE_PATH}/231_ekg.csv`, ann: `${BASE_PATH}/231_annotations_1.csv` },
  { ecg: `${BASE_PATH}/232_ekg.csv`, ann: `${BASE_PATH}/232_annotations_1.csv` },
  { ecg: `${BASE_PATH}/233_ekg.csv`, ann: `${BASE_PATH}/233_annotations_1.csv` },
  { ecg: `${BASE_PATH}/234_ekg.csv`, ann: `${BASE_PATH}/234_annotations_1.csv` }
];

// --- Train using all file pairs ---
export async function trainBeatLevelECGModelAllFiles(
  onEpoch?: (epoch: number, logs: tf.Logs) => void,
  onLog?: (msg: string) => void
) {
  const log = (msg: string) => {
    console.log(msg);
    if (onLog) onLog(msg);
  };

  const warn = (msg: string, ...args: any[]) => {
    console.warn(msg, ...args);
    if (onLog) onLog(`⚠️ ${msg}`);
  };

  log("Loading ECG data from all file pairs at original 360Hz sampling rate...");
  
  const allBeats: number[][] = [];
  const allLabels: string[] = [];

  for (const pair of allFilePairs) {
    try {
      log(`Loading ${pair.ecg}...`);
      const { beats, labels } = await loadBeatLevelData(pair.ecg, pair.ann, 135, 360, 360); // Updated parameters
      allBeats.push(...beats);
      allLabels.push(...labels);
      log(`Loaded ${beats.length} beats from ${pair.ecg}`);
    } catch (err) {
      warn(`Failed to load ${pair.ecg} or ${pair.ann}:`, err);
    }
  }

  log(`Total beats loaded: ${allBeats.length}`);
  if (allBeats.length === 0) {
    throw new Error("No beats loaded. Check your data files and paths.");
  }

  const { beats: balancedBeats, labels: balancedLabels, classes } = prepareBalancedBeatDataset(allBeats, allLabels);
  log(`Balanced dataset: ${balancedBeats.length} beats, classes: ${classes.join(", ")}`);

  const { X, y } = beatsToTensors(balancedBeats, balancedLabels, classes);

  // Split data
  const totalSamples = balancedBeats.length;
  const trainSize = Math.floor(totalSamples * 0.7);
  const valSize = Math.floor(totalSamples * 0.15);
  log(`Splitting data: train=${trainSize}, val=${valSize}, test=${totalSamples - trainSize - valSize}`);

  const [xTrain, xRest] = tf.split(X, [trainSize, totalSamples - trainSize]);
  const [yTrain, yRest] = tf.split(y, [trainSize, totalSamples - trainSize]);
  const [xVal, xTest] = tf.split(xRest, [valSize, totalSamples - trainSize - valSize]);
  const [yVal, yTest] = tf.split(yRest, [valSize, totalSamples - trainSize - valSize]);

  const model = buildBeatLevelModel(135, classes.length); // Updated input length
  log(`Model built with input shape [135, 1] and ${classes.length} output classes for 360Hz data`);

  log("Starting training...");
  let bestValAcc = 0;
  await model.fit(xTrain, yTrain, {
    epochs: 10,
    batchSize: 32,
    validationData: [xVal, yVal],
    shuffle: true,
    callbacks: {
      onEpochEnd: async (epoch, logs) => {
        const trainAcc = ((logs?.acc || logs?.categoricalAccuracy || 0) * 100);
        const valAcc = ((logs?.val_acc || logs?.val_categoricalAccuracy || 0) * 100);
        const trainLoss = logs?.loss?.toFixed(4);
        const valLoss = logs?.val_loss?.toFixed(4);
        bestValAcc = Math.max(bestValAcc, valAcc);

        const msg = `Epoch ${epoch + 1}/10 | Train Acc: ${trainAcc.toFixed(2)}% | Val Acc: ${valAcc.toFixed(2)}% | Train Loss: ${trainLoss} | Val Loss: ${valLoss}`;
        if (onLog) onLog(msg);
        if (onEpoch) onEpoch(epoch, logs ?? {} as tf.Logs);
      }
    }
  });

  log("Evaluating on test set...");
  const evalResult = await model.evaluate(xTest, yTest);
  let testAcc = 0;
  if (Array.isArray(evalResult)) {
    testAcc = (await evalResult[1].data())[0] * 100;
  } else {
    testAcc = (await evalResult.data())[0] * 100;
  }

  log(`Test Accuracy: ${testAcc.toFixed(2)}%`);
  log(`Best Validation Accuracy: ${bestValAcc.toFixed(2)}%`);

  log("Detected Classes: " + classes.join(", "));

  const predictions = model.predict(xTest) as tf.Tensor;
  const predClasses = await tf.argMax(predictions, 1).data();
  const trueClasses = await tf.argMax(yTest, 1).data();

  classes.forEach((className, classIdx) => {
    const tp = Array.from(predClasses).filter((pred, i) => pred === classIdx && trueClasses[i] === classIdx).length;
    const fp = Array.from(predClasses).filter((pred, i) => pred === classIdx && trueClasses[i] !== classIdx).length;
    const fn = Array.from(trueClasses).filter((true_, i) => true_ === classIdx && predClasses[i] !== classIdx).length;

    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1Score = precision + recall > 0 ? 2 * (precision * recall) / (precision + recall) : 0;

    log(
      `${className}: Precision=${(precision * 100).toFixed(1)}%, Recall=${(recall * 100).toFixed(1)}%, F1=${(f1Score * 100).toFixed(1)}%`
    );
  });

  await model.save('downloads://beat-level-ecg-model');
  X.dispose(); y.dispose(); xTrain.dispose(); yTrain.dispose(); xVal.dispose(); yVal.dispose(); xTest.dispose(); yTest.dispose();
  predictions.dispose();
  return model;
}
