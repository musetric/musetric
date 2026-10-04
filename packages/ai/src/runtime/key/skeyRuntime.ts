import * as ort from 'onnxruntime-web/webgpu';
import { type SkeyGraph } from '../modelGraphs.js';

ort.env.logLevel = 'error';

export type SkeyRuntime = {
  analyze: (audio: Float32Array) => Promise<Float32Array>;
  release: () => Promise<void>;
};

export type SkeyRuntimeOptions = {
  graph: SkeyGraph;
  modelFile: Uint8Array<ArrayBuffer>;
};

export const createSkeyRuntime = async (
  options: SkeyRuntimeOptions,
): Promise<SkeyRuntime> => {
  const { inputName, outputName } = options.graph;
  const session = await ort.InferenceSession.create(options.modelFile, {
    executionProviders: ['wasm'],
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
