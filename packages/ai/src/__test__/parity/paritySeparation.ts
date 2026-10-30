import { type StftInferenceTap } from '../../runtime/stftInference.js';
import { createVocalsGpuRuntime } from '../../runtime/vocals/vocalsRuntime.js';
import { fetchBytes } from '../../service/browserShared.js';
import { readGpuBuffer } from './parityGpu.js';
import {
  fetchTensor,
  type ParityOutput,
  type ParityVocalsTask,
} from './parityJob.js';

type ModelTaps = {
  input: Float32Array;
  output: Float32Array;
};

type TapReader = {
  inspect: (tap: StftInferenceTap) => Promise<void>;
  taps: () => ModelTaps;
};

const createTapReader = (): TapReader => {
  const read: Float32Array[] = [];
  return {
    inspect: async (tap) => {
      read.push(
        await readGpuBuffer(tap.device, tap.modelInput),
        await readGpuBuffer(tap.device, tap.modelOutput),
      );
    },
    taps: () => ({
      input: read[0] ?? new Float32Array(0),
      output: read[1] ?? new Float32Array(0),
    }),
  };
};

export const runVocalsTask = async (
  task: ParityVocalsTask,
): Promise<ParityOutput[]> => {
  const reader = createTapReader();
  const runtime = await createVocalsGpuRuntime({
    graph: task.graph,
    modelFile: await fetchBytes(task.modelUrl, 'the model'),
    modelDataFile: await fetchBytes(task.modelData.data, 'the model data'),
    modelDataPath: task.modelData.path,
    inspect: reader.inspect,
  });
  try {
    const { graph } = task;
    const input = Float32Array.from(await fetchTensor(task.unitInput));
    const output = new Float32Array(input.length * graph.masks);
    await runtime.processChunk({ input, output });
    const taps = reader.taps();
    const plane = [(graph.nFft / 2 + 1) * 2, graph.frames, 2];
    const [channels, ...samples] = task.unitInput.shape;
    return [
      {
        boundary: 'model.input',
        source: 'product',
        dtype: 'float32',
        shape: [1, ...plane],
        values: taps.input,
      },
      {
        boundary: 'model.output',
        source: 'product',
        dtype: 'float32',
        shape: [graph.masks, ...plane],
        values: taps.output,
      },
      {
        boundary: 'unit.output',
        source: 'product',
        dtype: 'float32',
        shape: [graph.masks * channels, ...samples],
        values: output,
      },
    ];
  } finally {
    await runtime.release();
  }
};
