import React, { useState } from 'react';
import {
  Play, User, Info
} from 'lucide-react';

import { PQRSTPoint } from '../lib/pqrstDetector';
import { ECGIntervals } from '../lib/ecgIntervals';

export type PatientInfo = {
  age: number;
  gender: 'male' | 'female';
  weight: number; // in kg
  height: number; // in cm
  medicalHistory: string[];
  medications: string[];
};

export type RecordingSession = {
  id: string;
  startTime: number;
  endTime: number | null;
  duration: number;
  patientInfo: PatientInfo;
  ecgData: number[];
  sampleRate: number;
  rPeaks: number[];
  pqrstPoints: PQRSTPoint[];
  // Add this new property
  intervals?: ECGIntervals | null;
}

export interface SessionRecordingProps {
  onStartRecording: (patientInfo: PatientInfo) => void;
  onClose: () => void;
}

const SessionRecording: React.FC<SessionRecordingProps> = ({
  onStartRecording,
  onClose,
}) => {
  const [patientInfo, setPatientInfo] = useState<PatientInfo>({
    age: 30,
    gender: 'male',
    weight: 70,
    height: 170,
    medicalHistory: [],
    medications: []
  });


  // Medical history options
  const historyOptions = [
    'Hypertension',
    'Diabetes',
    'Previous Heart Attack',
    'Arrhythmia',
    'Heart Failure',
    'Stroke',
    'None'
  ];

  // Common medications
  const medicationOptions = [
    'Beta Blockers',
    'ACE Inhibitors',
    'Calcium Channel Blockers',
    'Statins',
    'Anticoagulants',
    'Diuretics',
    'None'
  ];

  const toggleHistory = (item: string) => {
    if (item === 'None') {
      setPatientInfo({ ...patientInfo, medicalHistory: [] });
      return;
    }

    // Remove 'None' if it exists
    let newHistory = patientInfo.medicalHistory.filter(h => h !== 'None');

    if (newHistory.includes(item)) {
      newHistory = newHistory.filter(h => h !== item);
    } else {
      newHistory.push(item);
    }

    setPatientInfo({ ...patientInfo, medicalHistory: newHistory });
  };

  const toggleMedication = (item: string) => {
    if (item === 'None') {
      setPatientInfo({ ...patientInfo, medications: [] });
      return;
    }

    // Remove 'None' if it exists
    let newMeds = patientInfo.medications.filter(m => m !== 'None');

    if (newMeds.includes(item)) {
      newMeds = newMeds.filter(m => m !== item);
    } else {
      newMeds.push(item);
    }

    setPatientInfo({ ...patientInfo, medications: newMeds });
  };

 const handleStartRecording = () => {
    onStartRecording(patientInfo);
    onClose();
  };


  return (
    <>

      {/* Patient Info Modal */}
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-slate-900 border border-white/20 rounded-xl p-6 max-w-lg w-full">
          <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <User className="w-5 h-5 text-blue-400" />
            Patient Information
          </h2>

          <div className="text-gray-300 text-sm mb-4">
            <p>This information helps improve the accuracy of ECG analysis.</p>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-gray-300 text-sm mb-1">Age</label>
              <input
                type="number"
                value={patientInfo.age}
                onChange={(e) => setPatientInfo({ ...patientInfo, age: parseInt(e.target.value) || 0 })}
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white"
              />
            </div>

            <div>
              <label className="block text-gray-300 text-sm mb-1">Gender</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setPatientInfo({ ...patientInfo, gender: 'male' })}
                  className={`flex-1 py-2 rounded-lg text-sm ${patientInfo.gender === 'male'
                    ? 'bg-blue-500/30 border border-blue-500/60 text-blue-400'
                    : 'bg-gray-800/50 border border-gray-700 text-gray-400'
                    }`}
                >
                  Male
                </button>
                <button
                  onClick={() => setPatientInfo({ ...patientInfo, gender: 'female' })}
                  className={`flex-1 py-2 rounded-lg text-sm ${patientInfo.gender === 'female'
                    ? 'bg-pink-500/30 border border-pink-500/60 text-pink-400'
                    : 'bg-gray-800/50 border border-gray-700 text-gray-400'
                    }`}
                >
                  Female
                </button>
              </div>
            </div>

            <div>
              <label className="block text-gray-300 text-sm mb-1">Weight (kg)</label>
              <input
                type="number"
                value={patientInfo.weight}
                onChange={(e) => setPatientInfo({ ...patientInfo, weight: parseInt(e.target.value) || 0 })}
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white"
              />
            </div>

            <div>
              <label className="block text-gray-300 text-sm mb-1">Height (cm)</label>
              <input
                type="number"
                value={patientInfo.height}
                onChange={(e) => setPatientInfo({ ...patientInfo, height: parseInt(e.target.value) || 0 })}
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white"
              />
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-gray-300 text-sm mb-1">Medical History</label>
            <div className="flex flex-wrap gap-2">
              {historyOptions.map(option => (
                <button
                  key={option}
                  onClick={() => toggleHistory(option)}
                  className={`text-xs rounded-full px-3 py-1 border ${patientInfo.medicalHistory.includes(option)
                    ? 'bg-blue-500/20 border-blue-500/50 text-blue-400'
                    : 'bg-gray-800 border-gray-700 text-gray-400'
                    }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-gray-300 text-sm mb-1">Current Medications</label>
            <div className="flex flex-wrap gap-2">
              {medicationOptions.map(option => (
                <button
                  key={option}
                  onClick={() => toggleMedication(option)}
                  className={`text-xs rounded-full px-3 py-1 border ${patientInfo.medications.includes(option)
                    ? 'bg-purple-500/20 border-purple-500/50 text-purple-400'
                    : 'bg-gray-800 border-gray-700 text-gray-400'
                    }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-blue-900/20 border border-blue-500/20 rounded-lg p-3 text-xs text-blue-300 mb-6 flex items-start gap-2">
            <Info className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
            <p>All information is stored locally on your device and is not transmitted elsewhere. This data helps improve analysis accuracy.</p>
          </div>

          <div className="flex justify-between">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800"
            >
              Cancel
            </button>
            <button
              onClick={handleStartRecording}
              className="px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white flex items-center gap-2"
            >
              <Play className="w-4 h-4" fill="currentColor" />
              Start Recording
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export default SessionRecording;
