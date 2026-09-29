import {
  computeBufferEntries,
  type ComputeBufferKind,
} from '../common/computeBufferEntries.js';
import { decodeShader } from './decode.wgsl.js';
import { foldShader } from './fold.wgsl.js';
import { observeShader } from './observe.wgsl.js';
import { periodicityShader } from './periodicity.wgsl.js';
import { projectShader } from './project.wgsl.js';
import { sliceShader } from './slice.wgsl.js';
import { smoothShader } from './smooth.wgsl.js';
import { spectrumShader } from './spectrum.wgsl.js';

type PipelineSpec = {
  label: string;
  code: string;
  entryPoint: string;
  kinds: ComputeBufferKind[];
};

const createPipeline = (
  device: GPUDevice,
  spec: PipelineSpec,
): GPUComputePipeline => {
  const layout = device.createBindGroupLayout({
    label: `pitch-${spec.label}-bind-group-layout`,
    entries: computeBufferEntries(spec.kinds),
  });
  return device.createComputePipeline({
    label: `pitch-${spec.label}-pipeline`,
    layout: device.createPipelineLayout({
      label: `pitch-${spec.label}-pipeline-layout`,
      bindGroupLayouts: [layout],
    }),
    compute: {
      module: device.createShaderModule({
        label: `pitch-${spec.label}-shader`,
        code: spec.code,
      }),
      entryPoint: spec.entryPoint,
    },
  });
};

export type PitchPipelines = {
  slice: GPUComputePipeline;
  spectrum: GPUComputePipeline;
  periodicity: GPUComputePipeline;
  observe: GPUComputePipeline;
  decode: GPUComputePipeline;
  fold: GPUComputePipeline;
  smooth: GPUComputePipeline;
  project: GPUComputePipeline;
};

export const createPitchPipelines = (device: GPUDevice): PitchPipelines => ({
  slice: createPipeline(device, {
    label: 'slice',
    code: sliceShader,
    entryPoint: 'slice',
    kinds: [
      'read-only-storage',
      'read-only-storage',
      'read-only-storage',
      'storage',
      'dynamic-uniform',
    ],
  }),
  spectrum: createPipeline(device, {
    label: 'spectrum',
    code: spectrumShader,
    entryPoint: 'spectrum',
    kinds: [
      'read-only-storage',
      'read-only-storage',
      'storage',
      'storage',
      'storage',
      'dynamic-uniform',
    ],
  }),
  periodicity: createPipeline(device, {
    label: 'periodicity',
    code: periodicityShader,
    entryPoint: 'correlate',
    kinds: [
      'read-only-storage',
      'read-only-storage',
      'storage',
      'dynamic-uniform',
    ],
  }),
  observe: createPipeline(device, {
    label: 'observe',
    code: observeShader,
    entryPoint: 'observe',
    kinds: [
      'read-only-storage',
      'read-only-storage',
      'read-only-storage',
      'read-only-storage',
      'read-only-storage',
      'storage',
      'read-only-storage',
      'dynamic-uniform',
    ],
  }),
  decode: createPipeline(device, {
    label: 'decode',
    code: decodeShader,
    entryPoint: 'decode',
    kinds: ['read-only-storage', 'storage', 'dynamic-uniform'],
  }),
  fold: createPipeline(device, {
    label: 'fold',
    code: foldShader,
    entryPoint: 'foldPitch',
    kinds: [
      'read-only-storage',
      'read-only-storage',
      'storage',
      'dynamic-uniform',
    ],
  }),
  smooth: createPipeline(device, {
    label: 'smooth',
    code: smoothShader,
    entryPoint: 'smoothPitch',
    kinds: ['storage', 'read-only-storage', 'dynamic-uniform'],
  }),
  project: createPipeline(device, {
    label: 'project',
    code: projectShader,
    entryPoint: 'project',
    kinds: ['read-only-storage', 'storage', 'dynamic-uniform'],
  }),
});
