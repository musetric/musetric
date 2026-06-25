import { createShader } from './shader.js';

export const createPipeline = (device: GPUDevice, spectrumCount: number) => {
  const spectrumEntries = Array.from({ length: spectrumCount }).flatMap(
    (_, index): GPUBindGroupLayoutEntry[] => [
      {
        binding: 4 + index * 2,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'read-only-storage' },
      },
      {
        binding: 5 + index * 2,
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
      ...spectrumEntries,
    ],
  });
  const layout = device.createPipelineLayout({
    label: 'remap-pipeline-layout',
    bindGroupLayouts: [bindGroupLayout],
  });
  const module = device.createShaderModule({
    label: 'remap-column-shader',
    code: createShader(spectrumCount),
  });
  return {
    bindGroupLayout,
    computeIntensity: device.createComputePipeline({
      label: 'remap-compute-intensity-pipeline',
      layout,
      compute: { module, entryPoint: 'computeIntensity' },
    }),
    stats: device.createComputePipeline({
      label: 'remap-row-stats-pipeline',
      layout,
      compute: { module, entryPoint: 'collectRowStats' },
    }),
    render: device.createComputePipeline({
      label: 'remap-column-pipeline',
      layout,
      compute: { module, entryPoint: 'main' },
    }),
  };
};
