import { computeBufferEntries } from '../common/computeBufferEntries.js';
import { shader } from './sliceSamples.wgsl.js';

export const createPipeline = (device: GPUDevice) => {
  const layout = device.createBindGroupLayout({
    label: 'slice-samples-bind-group-layout',
    entries: computeBufferEntries([
      'read-only-storage',
      'storage',
      'dynamic-uniform',
      'read-only-storage',
    ]),
  });
  const pipelineLayout = device.createPipelineLayout({
    label: 'slice-samples-pipeline-layout',
    bindGroupLayouts: [layout],
  });
  const module = device.createShaderModule({
    label: 'slice-samples-shader',
    code: shader,
  });
  return device.createComputePipeline({
    label: 'slice-samples-pipeline',
    layout: pipelineLayout,
    compute: { module, entryPoint: 'main' },
  });
};
