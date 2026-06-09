import {
  createResourceCell,
  type ResourceCell,
} from '@musetric/resource-utils';
import { type FourierArg } from '../types.js';
import { createParams, type Params } from './params.js';
import {
  createPipeline,
  type MultiPassPipeline,
  type SinglePassPipeline,
} from './pipeline.js';
import {
  getPackedStockhamR2cVariant,
  type PackedStockhamR2cVariant,
} from './support.js';
import {
  createTrigTables,
  disposeTrigTables,
  type TrigTables,
} from './trigTables.js';

type ScratchBuffers = {
  buffer0: GPUBuffer;
  buffer1: GPUBuffer;
};

type SinglePassBindGroups = {
  kind: 'stockham' | 'inPlaceRadix4';
  transform: GPUBindGroup;
};

type MultiPassBindGroups = {
  kind: 'multiPass';
  stages: GPUBindGroup[];
  pack: GPUBindGroup;
};

type BaseState = {
  tables: TrigTables;
  params: Params;
  windowCount: number;
};

type SinglePassState = BaseState & {
  kind: 'stockham' | 'inPlaceRadix4';
  pipeline: SinglePassPipeline;
  bindGroups: SinglePassBindGroups;
};

type MultiPassState = BaseState & {
  kind: 'multiPass';
  variant: Extract<PackedStockhamR2cVariant, { kind: 'multiPass' }>;
  pipeline: MultiPassPipeline;
  bindGroups: MultiPassBindGroups;
  scratch: ScratchBuffers;
};

export type State = SinglePassState | MultiPassState;

const createScratchBuffers = (
  device: GPUDevice,
  variant: PackedStockhamR2cVariant,
  windowCount: number,
): ScratchBuffers => {
  const size =
    windowCount * variant.packedWindowSize * 2 * Float32Array.BYTES_PER_ELEMENT;

  return {
    buffer0: device.createBuffer({
      label: 'packed-stockham-r2c-multipass-scratch-0',
      size,
      usage: GPUBufferUsage.STORAGE,
    }),
    buffer1: device.createBuffer({
      label: 'packed-stockham-r2c-multipass-scratch-1',
      size,
      usage: GPUBufferUsage.STORAGE,
    }),
  };
};

const assertInPlaceTransform = (arg: FourierArg): void => {
  if (arg.wave !== arg.spectrum.real) {
    throw new Error(
      'fftPackedStockhamR2c currently requires wave and spectrum.real to use the same buffer',
    );
  }
};

const createSinglePassBindGroups = (
  device: GPUDevice,
  pipeline: SinglePassPipeline,
  tables: TrigTables,
  arg: FourierArg,
  params: Params,
): SinglePassBindGroups => ({
  kind: pipeline.kind,
  transform: device.createBindGroup({
    label: 'packed-stockham-r2c-transform-bind-group',
    layout: pipeline.transform.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: arg.spectrum.real } },
      { binding: 1, resource: { buffer: arg.spectrum.imag } },
      { binding: 2, resource: { buffer: tables.fft } },
      { binding: 3, resource: { buffer: tables.r2c } },
      { binding: 4, resource: { buffer: params.buffer } },
    ],
  }),
});

const createMultiPassBindGroups = (
  device: GPUDevice,
  pipeline: MultiPassPipeline,
  tables: TrigTables,
  scratch: ScratchBuffers,
  arg: FourierArg,
  params: Params,
): MultiPassBindGroups => ({
  kind: 'multiPass',
  stages: pipeline.stages.map((stagePipeline) =>
    device.createBindGroup({
      label: 'packed-stockham-r2c-multipass-stage-bind-group',
      layout: stagePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: arg.spectrum.real } },
        { binding: 1, resource: { buffer: scratch.buffer0 } },
        { binding: 2, resource: { buffer: scratch.buffer1 } },
        { binding: 3, resource: { buffer: tables.fft } },
        { binding: 4, resource: { buffer: params.buffer } },
      ],
    }),
  ),
  pack: device.createBindGroup({
    label: 'packed-stockham-r2c-multipass-pack-bind-group',
    layout: pipeline.pack.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: arg.spectrum.real } },
      { binding: 1, resource: { buffer: arg.spectrum.imag } },
      { binding: 2, resource: { buffer: scratch.buffer0 } },
      { binding: 3, resource: { buffer: scratch.buffer1 } },
      { binding: 4, resource: { buffer: tables.r2c } },
      { binding: 5, resource: { buffer: params.buffer } },
    ],
  }),
});

export const createStateCell = (
  device: GPUDevice,
): ResourceCell<FourierArg, State> =>
  createResourceCell({
    create: (arg): State => {
      assertInPlaceTransform(arg);
      const variant = getPackedStockhamR2cVariant(device, arg.config);
      if (variant === undefined) {
        throw new Error(
          `fftPackedStockhamR2c does not support windowSize=${arg.config.windowSize}`,
        );
      }
      const params = createParams(device, arg.config);
      const tables = createTrigTables(device, variant);

      if (variant.kind === 'multiPass') {
        const pipeline = createPipeline(device, variant);
        const scratch = createScratchBuffers(
          device,
          variant,
          arg.config.windowCount,
        );

        return {
          kind: 'multiPass',
          variant,
          pipeline,
          tables,
          bindGroups: createMultiPassBindGroups(
            device,
            pipeline,
            tables,
            scratch,
            arg,
            params,
          ),
          scratch,
          params,
          windowCount: arg.config.windowCount,
        };
      }

      const pipeline = createPipeline(device, variant);

      return {
        kind: variant.kind,
        pipeline,
        tables,
        bindGroups: createSinglePassBindGroups(
          device,
          pipeline,
          tables,
          arg,
          params,
        ),
        params,
        windowCount: arg.config.windowCount,
      };
    },
    dispose: (state) => {
      state.params.buffer.destroy();
      if (state.kind === 'multiPass') {
        state.scratch.buffer0.destroy();
        state.scratch.buffer1.destroy();
      }
      disposeTrigTables(state.tables);
    },
    equals: (current, next) =>
      current.wave === next.wave &&
      current.spectrum.real === next.spectrum.real &&
      current.spectrum.imag === next.spectrum.imag &&
      current.config.windowSize === next.config.windowSize &&
      current.config.windowCount === next.config.windowCount,
  });
