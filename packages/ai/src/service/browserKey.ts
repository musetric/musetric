import { keyMap } from '../key/keyMap.js';
import { type KeyResult } from '../key/types.js';
import {
  fetchFloat32,
  registerBrowserApi,
  reportLoading,
  reportRunning,
} from './browserShared.js';
import { analyzeKeyApiName, type BrowserAnalyzeKeyRequest } from './keyApi.js';

const peakNormalize = (audio: Float32Array): void => {
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

const argmax = (values: Float32Array): number => {
  let best = 0;
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] > values[best]) {
      best = i;
    }
  }
  return best;
};

export const registerKeyApi = (): void => {
  registerBrowserApi<BrowserAnalyzeKeyRequest, KeyResult>(
    analyzeKeyApiName,
    async (request) => {
      await reportLoading();
      const audio = await fetchFloat32(request.pcmUrl, 'key PCM');
      peakNormalize(audio);

      const { createSkeyRuntime } =
        await import('../runtime/key/skeyRuntime.js');
      const runtime = await createSkeyRuntime({ modelUrl: request.modelUrl });
      try {
        await reportRunning({ pass: 'decode', unit: 0, unitCount: 1 });
        const probs = await runtime.analyze(audio);
        const index = argmax(probs);
        const { root, mode } = keyMap[index];
        return { root, mode, confidence: probs[index] };
      } finally {
        await runtime.release();
      }
    },
  );
};
