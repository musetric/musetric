import {
  analyzeChordsInBrowser,
  analyzeKeyInBrowser,
  analyzeRhythmInBrowser,
  beatThisModel,
  chordNetModel,
  type ChordResult,
  type KeyResult,
  type RhythmResult,
  skeyModel,
} from '@musetric/ai/dom';
import { waitForGpuHeadroom } from '../app/waitForGpuHeadroom.js';
import { type ModelProgressHandler, type ModelStore } from '../models/index.js';
import { decodeMonoAudio } from './decodeAudio.js';

const fetchFloat32 = async (url: string): Promise<Float32Array> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }
  return new Float32Array(await response.arrayBuffer());
};

export type TrackAnalysis = {
  chords: ChordResult;
  key: KeyResult;
  rhythm: RhythmResult;
};

export type AnalyzeTrackOptions = {
  models: ModelStore;
  source: ArrayBuffer;
  onStage: (stage: string) => void;
  onModelProgress: ModelProgressHandler;
};

export const analyzeTrack = async (
  options: AnalyzeTrackOptions,
): Promise<TrackAnalysis> => {
  const { models, source, onStage, onModelProgress } = options;
  const decoded = new Map<number, Float32Array>();
  const decodeAt = async (sampleRate: number): Promise<Float32Array> => {
    const ready = decoded.get(sampleRate);
    if (ready) {
      return ready;
    }
    const audio = await decodeMonoAudio(source.slice(0), sampleRate);
    decoded.set(sampleRate, audio);
    return audio;
  };

  onStage('Downloading the chord model');
  const chordFiles = await models.ensureChordNetModel(onModelProgress);
  onStage('Downloading the key model');
  const keyModelUrl = await models.ensureSkeyModel(onModelProgress);
  onStage('Downloading the rhythm model');
  const rhythmFiles = await models.ensureBeatThisModel(onModelProgress);
  const filterbank = await fetchFloat32(rhythmFiles.filterbankUrl);

  onStage('Decoding the track');
  await decodeAt(chordNetModel.sampleRate);

  onStage('Recognizing chords');
  await waitForGpuHeadroom({
    activity: 'chord recognition',
    onProgress: onStage,
  });
  const chords = await analyzeChordsInBrowser({
    audio: await decodeAt(chordNetModel.sampleRate),
    modelUrl: chordFiles.modelUrl,
    planUrl: chordFiles.planUrl,
    planManifestUrl: chordFiles.planManifestUrl,
  });

  onStage('Detecting the key');
  await waitForGpuHeadroom({
    activity: 'key detection',
    onProgress: onStage,
  });
  const key = await analyzeKeyInBrowser({
    audio: await decodeAt(skeyModel.sampleRate),
    modelUrl: keyModelUrl,
  });

  onStage('Tracking the beat');
  await waitForGpuHeadroom({
    activity: 'beat tracking',
    onProgress: onStage,
  });
  const rhythm = await analyzeRhythmInBrowser({
    audio: await decodeAt(beatThisModel.sampleRate),
    modelUrl: rhythmFiles.modelUrl,
    filterbank,
  });

  return { chords, key, rhythm };
};
