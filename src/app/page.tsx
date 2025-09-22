"use client";

import { useState, useEffect, useRef } from 'react';
import { useModel } from '@/providers/ModelProvider';
import EcgPanel from '../components/EcgPanel';

export default function HomePage() {
  const { predict } = useModel();
  const autoAnalyzeInterval = useRef<NodeJS.Timeout | null>(null);
  
  type EcgIntervals = {
    rr?: number;
    bpm?: number;
    pr?: number;
    qrs?: number;
    qt?: number;
    qtc?: number;
    stDeviation?: number;
  };

  type HrvMetrics = {
    rmssd?: number;
    sdnn?: number;
    lfhf?: { ratio?: number };
  };

  type ModelPrediction = {
    prediction: string;
    confidence: number;
  };

  const [ecgIntervals, setEcgIntervals] = useState<EcgIntervals | null>(null);
  const [hrvMetrics, setHrvMetrics] = useState<HrvMetrics | null>(null);
  const [modelPrediction, setModelPrediction] = useState<ModelPrediction | null>(null);

  // Extract ECG features from current data
  const extractEcgFeatures = () => {
    if (!ecgIntervals || !hrvMetrics) return null;
    
    return {
      rr: ecgIntervals.rr || 800,
      bpm: ecgIntervals.bpm || 75,
      pr: ecgIntervals.pr || 160,
      qrs: ecgIntervals.qrs || 90,
      qt: ecgIntervals.qt || 380,
      qtc: ecgIntervals.qtc || 420,
      stDeviation: ecgIntervals.stDeviation || 0,
      rmssd: hrvMetrics.rmssd || 35,
      sdnn: hrvMetrics.sdnn || 50,
      lfhf: hrvMetrics.lfhf?.ratio || 1.5
    };
  };
  
  
  // Clean up interval on unmount
  useEffect(() => {
    return () => {
      const interval = autoAnalyzeInterval.current;
      if (interval) {
        clearInterval(interval);
      }
    };
  }, []);
  
  
  return (
    <div className="relative w-full h-screen overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <EcgPanel />
    </div>
  );
}

