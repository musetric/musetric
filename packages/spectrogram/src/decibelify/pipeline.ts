import { energyShader } from './energyShader.js';
import { runShader } from './runShader.js';

export type Pipelines = {
  layout: GPUBindGroupLayout;
  energy: GPUComputePipeline;
  run: GPUComputePipeline;
};

export const createPipelines = (device: GPUDevice): Pipelines => {
  const layout = device.createBindGroupLayout({
    label: 'decibelify-bind-group-layout',
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'read-only-storage' },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'uniform' },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'storage' },
      },
      {
        binding: 3,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'storage' },
      },
    ],
  });
  const pipelineLayout = device.createPipelineLayout({
    label: 'decibelify-pipeline-layout',
    bindGroupLayouts: [layout],
  });

  const runModule = device.createShaderModule({
    label: 'decibelify-run-shader',
    code: runShader,
  });
  const energyModule = device.createShaderModule({
    label: 'decibelify-energy-shader',
    code: energyShader,
  });
  const energy = device.createComputePipeline({
    label: 'decibelify-energy-pipeline',
    layout: pipelineLayout,
    compute: { module: energyModule, entryPoint: 'main' },
  });
  const run = device.createComputePipeline({
    label: 'decibelify-run-pipeline',
    layout: pipelineLayout,
    compute: { module: runModule, entryPoint: 'main' },
  });

  return {
    layout,
    energy,
    run,
  };
};
