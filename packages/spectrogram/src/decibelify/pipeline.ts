import { findMaxShader } from './findMaxShader.js';
import { runShader } from './runShader.js';

export type Pipelines = {
  layout: GPUBindGroupLayout;
  findMax: GPUComputePipeline;
  run: GPUComputePipeline;
};

export const createPipelines = (device: GPUDevice): Pipelines => {
  const layout = device.createBindGroupLayout({
    label: 'decibelify-bind-group-layout',
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'storage' },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'uniform' },
      },
    ],
  });
  const pipelineLayout = device.createPipelineLayout({
    label: 'decibelify-pipeline-layout',
    bindGroupLayouts: [layout],
  });

  const findMaxModule = device.createShaderModule({
    label: 'decibelify-find-max-shader',
    code: findMaxShader,
  });
  const findMax = device.createComputePipeline({
    label: 'decibelify-find-max-pipeline',
    layout: pipelineLayout,
    compute: { module: findMaxModule, entryPoint: 'main' },
  });

  const runModule = device.createShaderModule({
    label: 'decibelify-run-shader',
    code: runShader,
  });
  const run = device.createComputePipeline({
    label: 'decibelify-run-pipeline',
    layout: pipelineLayout,
    compute: { module: runModule, entryPoint: 'main' },
  });

  return {
    layout,
    findMax,
    run,
  };
};
