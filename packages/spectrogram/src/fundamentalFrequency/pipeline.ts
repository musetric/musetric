import { shader } from './fundamentalFrequency.wgsl.js';
import { trackShader } from './track.wgsl.js';

export type FundamentalFrequencyPipelines = {
  observe: GPUComputePipeline;
  track: GPUComputePipeline;
};

export const createPipelines = (
  device: GPUDevice,
): FundamentalFrequencyPipelines => {
  const observeLayout = device.createBindGroupLayout({
    label: 'fundamental-frequency-observe-bind-group-layout',
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'read-only-storage' },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'storage' },
      },
      {
        binding: 3,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'uniform', hasDynamicOffset: true },
      },
    ],
  });
  const trackLayout = device.createBindGroupLayout({
    label: 'fundamental-frequency-track-bind-group-layout',
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'read-only-storage' },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'storage' },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'uniform', hasDynamicOffset: true },
      },
    ],
  });
  const observePipelineLayout = device.createPipelineLayout({
    label: 'fundamental-frequency-observe-pipeline-layout',
    bindGroupLayouts: [observeLayout],
  });
  const trackPipelineLayout = device.createPipelineLayout({
    label: 'fundamental-frequency-track-pipeline-layout',
    bindGroupLayouts: [trackLayout],
  });
  const observeModule = device.createShaderModule({
    label: 'fundamental-frequency-observe-shader',
    code: shader,
  });
  const trackModule = device.createShaderModule({
    label: 'fundamental-frequency-track-shader',
    code: trackShader,
  });

  return {
    observe: device.createComputePipeline({
      label: 'fundamental-frequency-observe-pipeline',
      layout: observePipelineLayout,
      compute: {
        module: observeModule,
        entryPoint: 'observe',
      },
    }),
    track: device.createComputePipeline({
      label: 'fundamental-frequency-track-pipeline',
      layout: trackPipelineLayout,
      compute: {
        module: trackModule,
        entryPoint: 'track',
      },
    }),
  };
};
