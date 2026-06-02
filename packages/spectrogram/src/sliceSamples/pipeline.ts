import { shader } from './shader.js';

export const createPipeline = (device: GPUDevice) => {
  const module = device.createShaderModule({
    label: 'slice-samples-shader',
    code: shader,
  });
  return device.createComputePipeline({
    label: 'slice-samples-pipeline',
    layout: 'auto',
    compute: { module, entryPoint: 'main' },
  });
};
