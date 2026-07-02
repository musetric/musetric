import { shader } from './shader.js';

export const createPipeline = (device: GPUDevice) => {
  const layout = device.createBindGroupLayout({
    label: 'slice-samples-bind-group-layout',
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
      {
        binding: 3,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'read-only-storage' },
      },
    ],
  });
  const pipelineLayout = device.createPipelineLayout({
    label: 'slice-samples-pipeline-layout',
    bindGroupLayouts: [layout],
  });
  const module = device.createShaderModule({
    label: 'slice-samples-shader',
    code: shader,
  });
  return device.createComputePipeline({
    label: 'slice-samples-pipeline',
    layout: pipelineLayout,
    compute: { module, entryPoint: 'main' },
  });
};
