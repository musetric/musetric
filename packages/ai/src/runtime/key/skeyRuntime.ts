import * as ort from 'onnxruntime-web/webgpu';
import { skeyModel } from '../../models/skeyModel.js';
import { configureOrtWebGpu } from '../ortWebGpu.js';

ort.env.logLevel = 'error';

export type SkeyRuntime = {
  analyze: (audio: Float32Array) => Promise<Float32Array>;
  release: () => Promise<void>;
};

export type SkeyRuntimeOptions = {
  modelPath: string;
};

export const createSkeyRuntime = async (
  options: SkeyRuntimeOptions,
): Promise<SkeyRuntime> => {
  const { inputName, outputName } = skeyModel;
  configureOrtWebGpu();
  const session = await ort.InferenceSession.create(options.modelPath, {
    executionProviders: ['webgpu'],
    graphOptimizationLevel: 'all',
  });

  const analyze = async (audio: Float32Array): Promise<Float32Array> => {
    const input = new ort.Tensor('float32', audio, [1, audio.length]);
    const output = await session.run({ [inputName]: input });
    const probs = output[outputName].data;
    if (!(probs instanceof Float32Array)) {
      throw new Error('S-KEY model did not return float32 probabilities');
    }
    return probs;
  };

  const release = async (): Promise<void> => {
    await session.release();
  };

  return { analyze, release };
};
