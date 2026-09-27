import { createLeadBackingGpuRuntime } from '../../runtime/leadBacking/leadBackingRuntime.js';
import { type StftInferenceTap } from '../../runtime/stftInference.js';
import { createVocalsGpuRuntime } from '../../runtime/vocals/vocalsRuntime.js';
import { readGpuBuffer } from './parityGpu.js';
import {
  fetchTensor,
  type ParityOutput,
  type ParityVocalsTask,
  type ParityVoicesTask,
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

type StageOutputs = {
  modelShape: number[];
  unitShape: number[];
  taps: ModelTaps;
  unitOutput: Float32Array;
};

const stageOutputs = (outputs: StageOutputs): ParityOutput[] => [
  {
    boundary: 'model.input',
    source: 'product',
    dtype: 'float32',
    shape: outputs.modelShape,
    values: outputs.taps.input,
  },
  {
    boundary: 'model.output',
    source: 'product',
    dtype: 'float32',
    shape: outputs.modelShape,
    values: outputs.taps.output,
  },
  {
    boundary: 'unit.output',
    source: 'product',
    dtype: 'float32',
    shape: outputs.unitShape,
    values: outputs.unitOutput,
  },
];

const fetchAudio = async (task: ParityVocalsTask | ParityVoicesTask) =>
  Float32Array.from(await fetchTensor(task.unitInput));

export const runVocalsTask = async (
  task: ParityVocalsTask,
): Promise<ParityOutput[]> => {
  const reader = createTapReader();
  const runtime = await createVocalsGpuRuntime({
    graph: task.graph,
    modelUrl: task.modelUrl,
    modelDataUrl: task.modelData.data,
    modelDataPath: task.modelData.path,
    inspect: reader.inspect,
  });
  try {
    const input = await fetchAudio(task);
    const output = new Float32Array(input.length);
    await runtime.processChunk({ input, output });
    return stageOutputs({
      modelShape: [1, (task.graph.nFft / 2 + 1) * 2, task.graph.frames, 2],
      unitShape: task.unitInput.shape,
      taps: reader.taps(),
      unitOutput: output,
    });
  } finally {
    await runtime.release();
  }
};

export const runVoicesTask = async (
  task: ParityVoicesTask,
): Promise<ParityOutput[]> => {
  const reader = createTapReader();
  const runtime = await createLeadBackingGpuRuntime({
    graph: task.graph,
    modelUrl: task.modelUrl,
    inspect: reader.inspect,
  });
  try {
    const output = await runtime.processChunk(await fetchAudio(task));
    return stageOutputs({
      modelShape: [
        1,
        2 * task.graph.channels,
        task.graph.dimF,
        task.graph.frames,
      ],
      unitShape: task.unitInput.shape,
      taps: reader.taps(),
      unitOutput: output,
    });
  } finally {
    await runtime.release();
  }
};
