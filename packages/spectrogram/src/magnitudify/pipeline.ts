import { computeBufferEntries } from '../common/computeBufferEntries.js';
import { runShader } from './run.wgsl.js';

export type Pipelines = {
  layout: GPUBindGroupLayout;
  run: GPUComputePipeline;
};

export const createPipelines = (device: GPUDevice): Pipelines => {
  const layout = device.createBindGroupLayout({
    label: 'magnitudify-bind-group-layout',
    entries: computeBufferEntries(['storage', 'storage', 'dynamic-uniform']),
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
