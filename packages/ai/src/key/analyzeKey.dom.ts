import { createSkeyRuntime } from '../runtime/key/skeyRuntime.js';
import { peakNormalize, resolveKeyResult } from './keyProbabilities.es.js';
import { type KeyResult } from './types.js';

export type AnalyzeKeyInBrowserOptions = {
  audio: Float32Array;
  modelUrl: string;
};

export const analyzeKeyInBrowser = async (
  options: AnalyzeKeyInBrowserOptions,
): Promise<KeyResult> => {
  const { audio, modelUrl } = options;
  const normalized = Float32Array.from(audio);
  peakNormalize(normalized);
  const runtime = await createSkeyRuntime({ modelPath: modelUrl });
  const probs = await runtime
    .analyze(normalized)
    .finally(async () => runtime.release());
  return resolveKeyResult(probs);
};
