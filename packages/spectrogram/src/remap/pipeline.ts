import { shader } from './shader.js';

export const createPipeline = (device: GPUDevice) => {
  const module = device.createShaderModule({
    label: 'remap-column-shader',
    code: shader,
  });
  return device.createComputePipeline({
    label: 'remap-column-pipeline',
    layout: 'auto',
    compute: { module, entryPoint: 'main' },
  });
};
