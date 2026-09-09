import {
  createBindGroup,
  createBindGroupLayout,
  createComputePipeline,
  createStorageBuffer,
} from '../helpers.js';
import { type LeadBackingGraph } from '../modelGraphs.js';
import {
  createStftInferenceRuntime,
  type StftInferenceCore,
  type StftInferenceRuntime,
} from '../stftInference.js';
import { leadBackingFrameShader } from './frame.wgsl.js';
import { leadBackingOverlapAddShader } from './overlapAdd.wgsl.js';
import { leadBackingPackShader } from './pack.wgsl.js';
import { leadBackingUnpackShader } from './unpack.wgsl.js';

export type LeadBackingGpuRuntime = {
  processChunk: (
    input: Float32Array<ArrayBuffer>,
  ) => Promise<Float32Array<ArrayBuffer>>;
  release: () => Promise<void>;
};

export type LeadBackingGpuRuntimeOptions = {
  graph: LeadBackingGraph;
  modelUrl: string;
};

export const createLeadBackingGpuRuntime = async (
  options: LeadBackingGpuRuntimeOptions,
): Promise<LeadBackingGpuRuntime> => {
  const { graph } = options;
  const { nFft, frames, channels, dimF } = graph;
  const dimT = frames;
  const windowCount = channels * frames;
  const freqs = nFft / 2 + 1;
  const modelBytes = 4 * dimF * dimT * Float32Array.BYTES_PER_ELEMENT;
  const shape = [1, 4, dimF, dimT];

  const runtime: StftInferenceRuntime = await createStftInferenceRuntime({
    label: 'Lead/backing',
    model: graph,
    geometry: graph,
    inputShape: shape,
    outputShape: shape,
    modelUrl: options.modelUrl,
    frameShader: leadBackingFrameShader,
    overlapAddShader: leadBackingOverlapAddShader,
    createCore: (buffers): StftInferenceCore => {
      const { device, wave, spectrum } = buffers;
      const modelInput = createStorageBuffer(device, modelBytes);
      const modelOutput = createStorageBuffer(device, modelBytes);

      const packLayout = createBindGroupLayout(device, [
        'read-only-storage',
        'storage',
      ]);
      const packPipeline = createComputePipeline({
        device,
        layout: packLayout,
        code: leadBackingPackShader,
        constants: { nFft, frames, windowCount, dimF, dimT },
      });
      const unpackLayout = createBindGroupLayout(device, [
        'read-only-storage',
        'storage',
      ]);
      const unpackPipeline = createComputePipeline({
        device,
        layout: unpackLayout,
        code: leadBackingUnpackShader,
        constants: { nFft, frames, windowCount, dimF, dimT, freqs },
      });

      return {
        modelInput,
        modelOutput,
        analysis: {
          pipeline: packPipeline,
          bindGroup: createBindGroup(device, packLayout, [wave, modelInput]),
          x: dimF,
          y: windowCount,
        },
        synthesis: {
          pipeline: unpackPipeline,
          bindGroup: createBindGroup(device, unpackLayout, [
            modelOutput,
            spectrum,
          ]),
          x: freqs,
          y: windowCount,
        },
        release: () => {
          modelInput.destroy();
          modelOutput.destroy();
        },
      };
    },
  });

  return {
    processChunk: runtime.processChunk,
    release: runtime.release,
  };
};
