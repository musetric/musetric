import { computeBufferEntries } from '../common/computeBufferEntries.js';
import { createShader } from './remap.wgsl.js';

export const createPipeline = (device: GPUDevice, spectrumCount: number) => {
  const spectrumEntries = Array.from({ length: spectrumCount }).flatMap(
    (_, index) =>
      computeBufferEntries(
        ['read-only-storage', 'read-only-storage'],
        2 + index * 2,
      ),
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
