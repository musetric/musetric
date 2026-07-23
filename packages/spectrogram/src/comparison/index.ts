import { createResourceCell, type ResourceCell } from '@musetric/utils';
import { computeBufferEntries } from '../common/computeBufferEntries.js';
import { createDynamicUniformParams } from '../common/dynamicUniform.js';
import {
  type ExtSpectrogramConfig,
  type SpectrogramColumnRange,
} from '../common/extConfig.js';
import { colorShader } from './color.wgsl.js';

const workgroupSize = 64;
const paramsByteLength = 32;
const maxColorWindow = 128;

export type SpectrogramComparisonColorArg = {
  config: ExtSpectrogramConfig;
  referenceLine: GPUBuffer;
  targetLine: GPUBuffer;
};

export type ComparisonColorDispatchArg = {
  referenceBaseSlot: number;
  targetBaseSlot: number;
  range: SpectrogramColumnRange;
};

export type SpectrogramComparisonColor = {
  verdictBuffer: GPUBuffer;
  colorRadius: number;
  dispatch: (
    pass: GPUComputePassEncoder,
    arg: ComparisonColorDispatchArg,
  ) => void;
};

type ComparisonColorState = {
  verdictBuffer: GPUBuffer;
  params: ReturnType<typeof createDynamicUniformParams>;
  bindGroup: GPUBindGroup;
  windowCount: number;
  colorWindowLeft: number;
  colorWindowRight: number;
  colorFalloffSigma: number;
  colorRadius: number;
};

export const createSpectrogramComparisonColorCell = (
  device: GPUDevice,
): ResourceCell<SpectrogramComparisonColorArg, SpectrogramComparisonColor> => {
  const module = device.createShaderModule({
    label: 'comparison-color-shader',
    code: colorShader,
  });
  const bindGroupLayout = device.createBindGroupLayout({
    label: 'comparison-color-bind-group-layout',
    entries: computeBufferEntries([
      'read-only-storage',
      'read-only-storage',
      'storage',
      'dynamic-uniform',
    ]),
  });
  const pipeline = device.createComputePipeline({
    label: 'comparison-color-pipeline',
    layout: device.createPipelineLayout({
      label: 'comparison-color-pipeline-layout',
      bindGroupLayouts: [bindGroupLayout],
    }),
    compute: { module, entryPoint: 'colorize' },
  });

  const stateCell = createResourceCell({
    create: (arg: SpectrogramComparisonColorArg): ComparisonColorState => {
      const { config, referenceLine, targetLine } = arg;
      const { windowCount } = config;
      const secondsPerColumn = config.columnStep / config.sampleRate;
      const toColumns = (seconds: number) => seconds / secondsPerColumn;
      const colorWindowLeft = Math.min(
        maxColorWindow,
        Math.max(
          0,
          Math.ceil(toColumns(config.comparison.colorWindowLeftSeconds)),
        ),
      );
      const colorWindowRight = Math.min(
        maxColorWindow,
        Math.max(
          0,
          Math.ceil(toColumns(config.comparison.colorWindowRightSeconds)),
        ),
      );
      const colorFalloffSigma = Math.max(
        0.0001,
        toColumns(config.comparison.colorFalloffSigmaSeconds),
      );

      const verdictBuffer = device.createBuffer({
        label: 'comparison-color-verdict-buffer',
        size: Math.max(1, windowCount) * 2 * Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      const params = createDynamicUniformParams(device, {
        label: 'comparison-color-params-buffer',
        byteLength: paramsByteLength,
        capacity: windowCount,
      });
      const bindGroup = device.createBindGroup({
        label: 'comparison-color-bind-group',
        layout: bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: referenceLine } },
          { binding: 1, resource: { buffer: targetLine } },
          { binding: 2, resource: { buffer: verdictBuffer } },
          {
            binding: 3,
            resource: { buffer: params.buffer, size: params.byteLength },
          },
        ],
      });

      return {
        verdictBuffer,
        params,
        bindGroup,
        windowCount,
        colorWindowLeft,
        colorWindowRight,
        colorFalloffSigma,
        colorRadius: Math.max(colorWindowLeft, colorWindowRight),
      };
    },
    dispose: (state) => {
      state.params.destroy();
      state.verdictBuffer.destroy();
    },
    equals: (current, next) =>
      current.referenceLine === next.referenceLine &&
      current.targetLine === next.targetLine &&
      current.config.windowCount === next.config.windowCount &&
      current.config.columnStep === next.config.columnStep &&
      current.config.sampleRate === next.config.sampleRate &&
      current.config.comparison.colorWindowLeftSeconds ===
        next.config.comparison.colorWindowLeftSeconds &&
      current.config.comparison.colorWindowRightSeconds ===
        next.config.comparison.colorWindowRightSeconds &&
      current.config.comparison.colorFalloffSigmaSeconds ===
        next.config.comparison.colorFalloffSigmaSeconds,
  });

  return {
    get: (arg) => {
      const state = stateCell.get(arg);
      return {
        verdictBuffer: state.verdictBuffer,
        colorRadius: state.colorRadius,
        dispatch: (pass, dispatchArg) => {
          const { range, referenceBaseSlot, targetBaseSlot } = dispatchArg;
          if (range.columnCount <= 0) {
            return;
          }
          const byteOffset = state.params.write((view) => {
            view.setUint32(0, state.windowCount, true);
            view.setUint32(4, referenceBaseSlot, true);
            view.setUint32(8, targetBaseSlot, true);
            view.setUint32(12, range.screenBase, true);
            view.setUint32(16, range.columnCount, true);
            view.setUint32(20, state.colorWindowLeft, true);
            view.setUint32(24, state.colorWindowRight, true);
            view.setFloat32(28, state.colorFalloffSigma, true);
          });
          pass.setPipeline(pipeline);
          pass.setBindGroup(0, state.bindGroup, [byteOffset]);
          pass.dispatchWorkgroups(
            Math.max(1, Math.ceil(range.columnCount / workgroupSize)),
          );
        },
      };
    },
    dispose: () => {
      stateCell.dispose();
    },
  };
};
