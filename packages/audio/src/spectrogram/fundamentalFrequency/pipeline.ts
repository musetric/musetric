import filterShaderCode from './filter.wgsl?raw';
import shaderCode from './index.wgsl?raw';

export type FundamentalFrequencyPipelines = {
  detect: GPUComputePipeline;
  filter: GPUComputePipeline;
};

export const createPipelines = (
  device: GPUDevice,
): FundamentalFrequencyPipelines => {
  const module = device.createShaderModule({
    label: 'fundamental-frequency-shader',
    code: shaderCode,
  });
  const filterModule = device.createShaderModule({
    label: 'fundamental-frequency-filter-shader',
    code: filterShaderCode,
  });

  return {
    detect: device.createComputePipeline({
      label: 'fundamental-frequency-pipeline',
      layout: 'auto',
      compute: {
        module,
        entryPoint: 'main',
      },
    }),
    filter: device.createComputePipeline({
      label: 'fundamental-frequency-filter-pipeline',
      layout: 'auto',
      compute: {
        module: filterModule,
        entryPoint: 'main',
      },
    }),
  };
};
