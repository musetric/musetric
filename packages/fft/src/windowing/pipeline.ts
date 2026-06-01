import { shaderCode } from './shader.js';

export const createPipeline = (device: GPUDevice) => {
  const module = device.createShaderModule({
    label: 'windowing-shader',
    code: shaderCode,
  });
  return device.createComputePipeline({
    label: 'windowing-pipeline',
    layout: 'auto',
    compute: { module, entryPoint: 'main' },
  });
};
