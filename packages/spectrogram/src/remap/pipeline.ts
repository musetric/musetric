import { createShader } from './shader.js';

export const createPipeline = (device: GPUDevice, spectrumCount: number) => {
  const module = device.createShaderModule({
    label: 'remap-column-shader',
    code: createShader(spectrumCount),
  });
  return device.createComputePipeline({
    label: 'remap-column-pipeline',
    layout: 'auto',
    compute: { module, entryPoint: 'main' },
  });
};
