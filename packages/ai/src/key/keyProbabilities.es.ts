import { keyMap } from './keyMap.js';
import { type KeyResult } from './types.js';

export const peakNormalize = (audio: Float32Array): void => {
  let peak = 0;
  for (const sample of audio) {
    const magnitude = Math.abs(sample);
    if (magnitude > peak) {
      peak = magnitude;
    }
  }
  if (peak > 0) {
    for (let i = 0; i < audio.length; i += 1) {
      audio[i] /= peak;
    }
  }
};

export const resolveKeyResult = (probs: Float32Array): KeyResult => {
  let best = 0;
  for (let i = 1; i < probs.length; i += 1) {
    if (probs[i] > probs[best]) {
      best = i;
    }
  }
  const { root, mode } = keyMap[best];
  return { root, mode, confidence: probs[best] };
};
