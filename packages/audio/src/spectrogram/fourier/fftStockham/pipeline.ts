import transformShader from './transform.wgsl?raw';
import transformSharedShader from './transformShared.wgsl?raw';

export const createTransformPipeline = (
  device: GPUDevice,
): GPUComputePipeline => {
  const module = device.createShaderModule({
    label: 'stockham-transform-shader',
    code: transformShader,
  });
  return device.createComputePipeline({
    label: 'stockham-transform-pipeline',
    layout: 'auto',
    compute: { module, entryPoint: 'main' },
  });
};

export const createSharedModule = (device: GPUDevice): GPUShaderModule =>
  device.createShaderModule({
    label: 'stockham-shared-shader',
    code: transformSharedShader,
  });

export const createSharedPipeline = (
  device: GPUDevice,
  module: GPUShaderModule,
  windowSize: number,
): GPUComputePipeline =>
  device.createComputePipeline({
    label: `stockham-shared-pipeline-${windowSize}`,
    layout: 'auto',
    compute: {
      module,
      entryPoint: 'main',
      constants: {
        windowSize,
        log2Size: Math.log2(windowSize),
      },
    },
  });
