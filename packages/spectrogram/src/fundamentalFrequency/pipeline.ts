import { filterShader } from './filter.wgsl.js';
import { shader } from './fundamentalFrequency.wgsl.js';

export type FundamentalFrequencyPipelines = {
  scoreAndPick: GPUComputePipeline;
  filter: GPUComputePipeline;
};

export const createPipelines = (
  device: GPUDevice,
): FundamentalFrequencyPipelines => {
  const scoreAndPickLayout = device.createBindGroupLayout({
    label: 'fundamental-frequency-score-and-pick-bind-group-layout',
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
  const filterLayout = device.createBindGroupLayout({
    label: 'fundamental-frequency-filter-bind-group-layout',
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
  const scoreAndPickPipelineLayout = device.createPipelineLayout({
    label: 'fundamental-frequency-score-and-pick-pipeline-layout',
    bindGroupLayouts: [scoreAndPickLayout],
  });
  const filterPipelineLayout = device.createPipelineLayout({
    label: 'fundamental-frequency-filter-pipeline-layout',
    bindGroupLayouts: [filterLayout],
  });
  const module = device.createShaderModule({
    label: 'fundamental-frequency-shader',
    code: shader,
  });
  const filterModule = device.createShaderModule({
    label: 'fundamental-frequency-filter-shader',
    code: filterShader,
  });

  return {
    scoreAndPick: device.createComputePipeline({
      label: 'fundamental-frequency-score-and-pick-pipeline',
      layout: scoreAndPickPipelineLayout,
      compute: {
        module,
        entryPoint: 'scoreAndPick',
      },
    }),
    filter: device.createComputePipeline({
      label: 'fundamental-frequency-filter-pipeline',
      layout: filterPipelineLayout,
      compute: {
        module: filterModule,
        entryPoint: 'main',
      },
    }),
  };
};
