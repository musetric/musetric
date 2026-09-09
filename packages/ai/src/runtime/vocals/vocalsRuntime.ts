import {
  createBindGroup,
  createBindGroupLayout,
  createComputePipeline,
  createStorageBuffer,
} from '../helpers.js';
import { type VocalsGraph } from '../modelGraphs.js';
import {
  createStftInferenceRuntime,
  type StftInferenceCore,
  type StftInferenceRuntime,
} from '../stftInference.js';
import { vocalsApplyMasksShader } from './applyMasks.wgsl.js';
import { vocalsFrameShader } from './frame.wgsl.js';
import { vocalsOverlapAddShader } from './overlapAdd.wgsl.js';
import { vocalsPackShader } from './pack.wgsl.js';

export type VocalsProcessChunkOptions = {
  input: Float32Array<ArrayBuffer>;
  output: Float32Array<ArrayBuffer>;
};

export type VocalsGpuRuntime = {
  processChunk: (options: VocalsProcessChunkOptions) => Promise<void>;
  release: () => Promise<void>;
};

export type VocalsGpuRuntimeOptions = {
  graph: VocalsGraph;
  modelUrl: string;
  modelDataUrl: string;
  modelDataPath: string;
};

export const createVocalsGpuRuntime = async (
  options: VocalsGpuRuntimeOptions,
): Promise<VocalsGpuRuntime> => {
  const { graph } = options;
  const { nFft, frames } = graph;
  const packedBins = (nFft / 2 + 1) * 2;
  const modelBytes = packedBins * frames * 2 * Float32Array.BYTES_PER_ELEMENT;
  const shape = [1, packedBins, frames, 2];

  const runtime: StftInferenceRuntime = await createStftInferenceRuntime({
    label: 'Vocals',
    model: graph,
    geometry: graph,
    inputShape: shape,
    outputShape: shape,
    modelUrl: options.modelUrl,
    externalData: [{ path: options.modelDataPath, data: options.modelDataUrl }],
    frameShader: vocalsFrameShader,
    overlapAddShader: vocalsOverlapAddShader,
    createCore: (buffers): StftInferenceCore => {
      const { device, wave, spectrum } = buffers;
      const stft = createStorageBuffer(device, modelBytes);
      const masks = createStorageBuffer(device, modelBytes);

      const packLayout = createBindGroupLayout(device, [
        'read-only-storage',
        'storage',
      ]);
      const packPipeline = createComputePipeline({
        device,
        layout: packLayout,
        code: vocalsPackShader,
        constants: { nFft, frames, packedBins },
      });
      const applyMasksLayout = createBindGroupLayout(device, [
        'read-only-storage',
        'read-only-storage',
        'storage',
      ]);
      const applyMasksPipeline = createComputePipeline({
        device,
        layout: applyMasksLayout,
        code: vocalsApplyMasksShader,
        constants: { nFft, frames, packedBins },
      });

      return {
        modelInput: stft,
        modelOutput: masks,
        analysis: {
          pipeline: packPipeline,
          bindGroup: createBindGroup(device, packLayout, [wave, stft]),
          x: packedBins,
          y: frames,
        },
        synthesis: {
          pipeline: applyMasksPipeline,
          bindGroup: createBindGroup(device, applyMasksLayout, [
            stft,
            masks,
            spectrum,
          ]),
          x: packedBins,
          y: frames,
        },
        release: () => {
          stft.destroy();
          masks.destroy();
        },
      };
    },
  });

  const processChunk = async (
    chunkOptions: VocalsProcessChunkOptions,
  ): Promise<void> => {
    await runtime.processChunk(chunkOptions.input, chunkOptions.output);
  };

  return { processChunk, release: runtime.release };
};
