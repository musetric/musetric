import { createResourceCell } from '@musetric/utils';
import { comparisonShader } from './comparison.wgsl.js';
import { harmonicsShader } from './harmonics.wgsl.js';

const workgroupSize = 64;
export const harmonicsLayerCount = 2;

const createComputePipeline = (
  device: GPUDevice,
  label: string,
  code: string,
) =>
  device.createComputePipeline({
    label: `${label}-pipeline`,
    layout: 'auto',
    compute: {
      module: device.createShaderModule({ label: `${label}-shader`, code }),
      entryPoint: 'main',
    },
  });

export const createHarmonicsPipeline = (device: GPUDevice) =>
  createComputePipeline(device, 'harmonics', harmonicsShader);

export const createComparisonPipeline = (device: GPUDevice) =>
  createComputePipeline(device, 'harmonic-comparison', comparisonShader);

export const createDominantHarmonicsCell = (device: GPUDevice) =>
  createResourceCell({
    create: (windowCount: number): GPUBuffer =>
      device.createBuffer({
        label: 'dominant-harmonics-buffer',
        size:
          Math.max(1, windowCount) *
          harmonicsLayerCount *
          Uint32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      }),
    dispose: (buffer) => {
      buffer.destroy();
    },
    equals: (current, next) => current === next,
  });

export type HarmonicDifferencesArg = {
  windowCount: number;
  maxHarmonics: number;
};

export const createHarmonicDifferencesCell = (device: GPUDevice) =>
  createResourceCell({
    create: (arg: HarmonicDifferencesArg): GPUBuffer =>
      device.createBuffer({
        label: 'harmonic-differences-buffer',
        size:
          Math.max(1, arg.windowCount * arg.maxHarmonics) *
          2 *
          Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.STORAGE,
      }),
    dispose: (buffer) => {
      buffer.destroy();
    },
    equals: (current, next) =>
      current.windowCount === next.windowCount &&
      current.maxHarmonics === next.maxHarmonics,
  });

export type HarmonicsBindGroupArg = {
  arrayView: GPUTextureView;
  referenceLine: GPUBuffer;
  targetLine: GPUBuffer;
  output: GPUBuffer;
  colors: GPUBuffer;
};

export const createHarmonicsBindGroupCell = (
  device: GPUDevice,
  pipeline: GPUComputePipeline,
) =>
  createResourceCell({
    create: (arg: HarmonicsBindGroupArg): GPUBindGroup =>
      device.createBindGroup({
        label: `${pipeline.label}-bind-group`,
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: arg.colors } },
          { binding: 1, resource: arg.arrayView },
          { binding: 2, resource: { buffer: arg.referenceLine } },
          { binding: 3, resource: { buffer: arg.targetLine } },
          { binding: 4, resource: { buffer: arg.output } },
        ],
      }),
    dispose: () => undefined,
    equals: (current, next) =>
      current.arrayView === next.arrayView &&
      current.referenceLine === next.referenceLine &&
      current.targetLine === next.targetLine &&
      current.output === next.output &&
      current.colors === next.colors,
  });

export type HarmonicsDispatchSize = {
  windowCount: number;
  layers: number;
};

export const dispatchHarmonics = (
  encoder: GPUCommandEncoder,
  pipeline: GPUComputePipeline,
  bindGroup: GPUBindGroup,
  size: HarmonicsDispatchSize,
) => {
  const pass = encoder.beginComputePass({ label: `${pipeline.label}-pass` });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(
    Math.ceil(size.windowCount / workgroupSize),
    size.layers,
  );
  pass.end();
};
