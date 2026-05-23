import filterShaderCode from './filter.wgsl?raw';
import shaderCode from './index.wgsl?raw';

export type FundamentalFrequencyPipelines = {
  scoreCandidates: GPUComputePipeline;
  pickBest: GPUComputePipeline;
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
    scoreCandidates: device.createComputePipeline({
      label: 'fundamental-frequency-score-candidates-pipeline',
      layout: 'auto',
      compute: {
        module,
        entryPoint: 'scoreCandidates',
      },
    }),
    pickBest: device.createComputePipeline({
      label: 'fundamental-frequency-pick-best-pipeline',
      layout: 'auto',
      compute: {
        module,
        entryPoint: 'pickBest',
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
