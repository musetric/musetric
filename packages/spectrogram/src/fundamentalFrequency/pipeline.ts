import { computeBufferEntries } from '../common/computeBufferEntries.js';
import { autocorrelationShader } from './autocorrelation.wgsl.js';
import { shader } from './fundamentalFrequency.wgsl.js';
import { trackShader } from './track.wgsl.js';

export type FundamentalFrequencyPipelines = {
  autocorr: GPUComputePipeline;
  observe: GPUComputePipeline;
  track: GPUComputePipeline;
};

export const createPipelines = (
  device: GPUDevice,
): FundamentalFrequencyPipelines => {
  const autocorrLayout = device.createBindGroupLayout({
    label: 'fundamental-frequency-autocorr-bind-group-layout',
    entries: computeBufferEntries([
      'read-only-storage',
      'storage',
      'dynamic-uniform',
    ]),
  });
  const observeLayout = device.createBindGroupLayout({
    label: 'fundamental-frequency-observe-bind-group-layout',
    entries: computeBufferEntries([
      'read-only-storage',
      'read-only-storage',
      'storage',
      'dynamic-uniform',
    ]),
  });
  const trackLayout = device.createBindGroupLayout({
    label: 'fundamental-frequency-track-bind-group-layout',
    entries: computeBufferEntries([
      'read-only-storage',
      'storage',
      'dynamic-uniform',
    ]),
  });
  const autocorrPipelineLayout = device.createPipelineLayout({
    label: 'fundamental-frequency-autocorr-pipeline-layout',
    bindGroupLayouts: [autocorrLayout],
  });
  const observePipelineLayout = device.createPipelineLayout({
    label: 'fundamental-frequency-observe-pipeline-layout',
    bindGroupLayouts: [observeLayout],
  });
  const trackPipelineLayout = device.createPipelineLayout({
    label: 'fundamental-frequency-track-pipeline-layout',
    bindGroupLayouts: [trackLayout],
  });
  const observeModule = device.createShaderModule({
    label: 'fundamental-frequency-observe-shader',
    code: shader,
  });
  const autocorrModule = device.createShaderModule({
    label: 'fundamental-frequency-autocorr-shader',
    code: autocorrelationShader,
  });
  const trackModule = device.createShaderModule({
    label: 'fundamental-frequency-track-shader',
    code: trackShader,
  });

  return {
    autocorr: device.createComputePipeline({
      label: 'fundamental-frequency-autocorr-pipeline',
      layout: autocorrPipelineLayout,
      compute: {
        module: autocorrModule,
        entryPoint: 'autocorr',
      },
    }),
    observe: device.createComputePipeline({
      label: 'fundamental-frequency-observe-pipeline',
      layout: observePipelineLayout,
      compute: {
        module: observeModule,
        entryPoint: 'observe',
      },
    }),
    track: device.createComputePipeline({
      label: 'fundamental-frequency-track-pipeline',
      layout: trackPipelineLayout,
      compute: {
        module: trackModule,
        entryPoint: 'track',
      },
    }),
  };
};
