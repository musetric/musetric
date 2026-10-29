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
  type StftInferenceTap,
  type StftStage,
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
  modelFile: Uint8Array<ArrayBuffer>;
  modelDataFile: Uint8Array<ArrayBuffer>;
  modelDataPath: string;
  inspect?: (tap: StftInferenceTap) => Promise<void>;
};

export const createVocalsGpuRuntime = async (
  options: VocalsGpuRuntimeOptions,
): Promise<VocalsGpuRuntime> => {
  const { graph } = options;
  const { nFft, frames, masks } = graph;
  const packedBins = (nFft / 2 + 1) * 2;
  const planeBytes = packedBins * frames * 2 * Float32Array.BYTES_PER_ELEMENT;
  const plane = [packedBins, frames, 2];

  const runtime: StftInferenceRuntime = await createStftInferenceRuntime({
    label: 'Vocals',
    model: graph,
    geometry: graph,
    inputShape: [1, ...plane],
    outputShape: [masks, ...plane],
    modelFile: options.modelFile,
    externalData: [
      { path: options.modelDataPath, data: options.modelDataFile },
    ],
    frameShader: vocalsFrameShader,
    overlapAddShader: vocalsOverlapAddShader,
    graphCapture: true,
    inspect: options.inspect,
    createCore: (buffers): StftInferenceCore => {
      const { device, wave, spectrum } = buffers;
      const stft = createStorageBuffer(device, planeBytes);
      const maskPlanes = createStorageBuffer(device, masks * planeBytes);

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
      const applyMasksBindGroup = createBindGroup(device, applyMasksLayout, [
        stft,
        maskPlanes,
        spectrum,
      ]);
      const syntheses = Array.from({ length: masks }, (_, stem): StftStage => ({
        pipeline: createComputePipeline({
          device,
          layout: applyMasksLayout,
          code: vocalsApplyMasksShader,
          constants: { nFft, frames, packedBins, chainedMasks: stem + 1 },
        }),
        bindGroup: applyMasksBindGroup,
        x: packedBins,
        y: frames,
      }));

      return {
        modelInput: stft,
        modelOutput: maskPlanes,
        analysis: {
          pipeline: packPipeline,
          bindGroup: createBindGroup(device, packLayout, [wave, stft]),
          x: packedBins,
          y: frames,
        },
        syntheses,
        release: () => {
          stft.destroy();
          maskPlanes.destroy();
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
