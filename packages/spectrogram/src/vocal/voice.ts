import {
  measureVocalFrames,
  type MeasureVocalFramesInput,
  type VocalFrames,
} from './frames.js';
import { findPhrases, type VocalPhrase } from './segments.js';

export type VocalVoice = {
  frames: VocalFrames;
  phrases: VocalPhrase[];
  songSeconds: (frame: number) => number;
};

export type AnalyzeVocalVoiceInput = MeasureVocalFramesInput & {
  songSample: (sample: number) => number;
};

export const analyzeVocalVoice = async (
  input: AnalyzeVocalVoiceInput,
): Promise<VocalVoice> => {
  const frames = await measureVocalFrames(input);
  const hop = frames.hopSeconds * frames.sampleRate;
  return {
    frames,
    phrases: findPhrases(frames),
    songSeconds: (frame) =>
      input.songSample((frames.firstFrame + frame) * hop) / frames.sampleRate,
  };
};
