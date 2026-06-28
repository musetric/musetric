import { runShader } from './runShader.js';

export type Pipelines = {
  layout: GPUBindGroupLayout;
  run: GPUComputePipeline;
};

export const createPipelines = (device: GPUDevice): Pipelines => {
  const layout = device.createBindGroupLayout({
    label: 'magnitudify-bind-group-layout',
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'storage' },
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
  const pipelineLayout = device.createPipelineLayout({
    label: 'magnitudify-pipeline-layout',
    bindGroupLayouts: [layout],
  });

  const runModule = device.createShaderModule({
    label: 'magnitudify-run-shader',
    code: runShader,
  });
  const run = device.createComputePipeline({
    label: 'magnitudify-run-pipeline',
    layout: pipelineLayout,
    compute: { module: runModule, entryPoint: 'main' },
  });

  return {
    layout,
    run,
  };
};
