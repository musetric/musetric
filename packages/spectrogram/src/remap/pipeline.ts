import { createShader } from './shader.js';

export const createPipeline = (device: GPUDevice, spectrumCount: number) => {
  const spectrumEntries = Array.from({ length: spectrumCount }).flatMap(
    (_, index): GPUBindGroupLayoutEntry[] => [
      {
        binding: 2 + index * 2,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'read-only-storage' },
      },
      {
        binding: 3 + index * 2,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'read-only-storage' },
      },
    ],
  );
  const bindGroupLayout = device.createBindGroupLayout({
    label: 'remap-bind-group-layout',
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: {
          access: 'write-only',
          format: 'rgba8unorm',
          viewDimension: '2d',
        },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'uniform', hasDynamicOffset: true },
      },
      ...spectrumEntries,
    ],
  });
  const layout = device.createPipelineLayout({
    label: 'remap-pipeline-layout',
    bindGroupLayouts: [bindGroupLayout],
  });
  const module = device.createShaderModule({
    label: 'remap-shader',
    code: createShader(spectrumCount),
  });
  return {
    bindGroupLayout,
    compute: device.createComputePipeline({
      label: 'remap-pipeline',
      layout,
      compute: { module, entryPoint: 'main' },
    }),
  };
};
