import {
  createResourceCell,
  type ResourceCell,
} from '@musetric/resource-utils';
import { type FourierArg } from '../types.js';
import { createParams, type Params } from './params.js';
import {
  createPipeline,
  type MultiPassPipeline,
  type Pipeline,
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

type Resources = {
  pipeline: Pipeline;
  tables: TrigTables;
};

type ScratchBuffers = {
  buffer0: GPUBuffer;
  buffer1: GPUBuffer;
};

type SinglePassBindGroups = {
  kind: 'stockham' | 'inPlaceRadix4' | 'inPlaceMixed';
  transform: GPUBindGroup;
};

type MultiPassBindGroups = {
  kind: 'multiPass';
  stages: GPUBindGroup[];
};

type BindGroups = SinglePassBindGroups | MultiPassBindGroups;

type BaseState = {
  kind: PackedStockhamR2cVariant['kind'];
  variant: PackedStockhamR2cVariant;
  pipeline: Pipeline;
  tables: TrigTables;
  bindGroups: BindGroups;
  params: Params;
  dummyInput: GPUBuffer;
  windowCount: number;
};

type SinglePassState = BaseState & {
  kind: 'stockham' | 'inPlaceRadix4' | 'inPlaceMixed';
  variant: Exclude<PackedStockhamR2cVariant, { kind: 'multiPass' }>;
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

function createResources(
  device: GPUDevice,
  variant: Exclude<PackedStockhamR2cVariant, { kind: 'multiPass' }>,
  inPlace: boolean,
): {
  pipeline: SinglePassPipeline;
  tables: TrigTables;
};
function createResources(
  device: GPUDevice,
  variant: Extract<PackedStockhamR2cVariant, { kind: 'multiPass' }>,
  inPlace: boolean,
): {
  pipeline: MultiPassPipeline;
  tables: TrigTables;
};
function createResources(
  device: GPUDevice,
  variant: PackedStockhamR2cVariant,
  inPlace: boolean,
): Resources {
  if (variant.kind === 'multiPass') {
    return {
      pipeline: createPipeline(device, variant, inPlace),
      tables: createTrigTables(device, variant),
    };
  }

  return {
    pipeline: createPipeline(device, variant, inPlace),
    tables: createTrigTables(device, variant),
  };
}

const createDummyInputBuffer = (device: GPUDevice): GPUBuffer => {
  return device.createBuffer({
    label: 'packed-stockham-r2c-dummy-input',
    size: Float32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.STORAGE,
  });
};

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

const createSinglePassBindGroups = (
  device: GPUDevice,
  pipeline: Extract<
    Pipeline,
    { kind: 'stockham' | 'inPlaceRadix4' | 'inPlaceMixed' }
  >,
  tables: TrigTables,
  arg: FourierArg,
  params: Params,
  input: GPUBuffer,
): SinglePassBindGroups => ({
  kind: pipeline.kind,
  transform: device.createBindGroup({
    label: 'packed-stockham-r2c-transform-bind-group',
    layout: pipeline.transform.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: input } },
      { binding: 1, resource: { buffer: arg.spectrum } },
      { binding: 2, resource: { buffer: tables.fft } },
      { binding: 3, resource: { buffer: tables.r2c } },
      { binding: 4, resource: { buffer: params.buffer } },
    ],
  }),
});

const createMultiPassBindGroups = (
  device: GPUDevice,
  pipeline: Extract<Pipeline, { kind: 'multiPass' }>,
  tables: TrigTables,
  scratch: ScratchBuffers,
  arg: FourierArg,
  params: Params,
  input: GPUBuffer,
): MultiPassBindGroups => ({
  kind: 'multiPass',
  stages: pipeline.stages.map((stagePipeline) =>
    device.createBindGroup({
      label: 'packed-stockham-r2c-multipass-stage-bind-group',
      layout: stagePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: input } },
        { binding: 1, resource: { buffer: arg.spectrum } },
        { binding: 2, resource: { buffer: scratch.buffer0 } },
        { binding: 3, resource: { buffer: scratch.buffer1 } },
        { binding: 4, resource: { buffer: tables.fft } },
        { binding: 5, resource: { buffer: params.buffer } },
        { binding: 6, resource: { buffer: tables.r2c } },
      ],
    }),
  ),
});

export const createStateCell = (
  device: GPUDevice,
): ResourceCell<FourierArg, State> =>
  createResourceCell({
    create: (arg): State => {
      const inPlace = arg.wave === arg.spectrum;
      const variant = getPackedStockhamR2cVariant(device, arg.config);
      if (variant === undefined) {
        throw new Error(
          `fftPackedStockhamR2c does not support windowSize=${arg.config.windowSize}`,
        );
      }
      const params = createParams(device, arg.config);
      const dummyInput = createDummyInputBuffer(device);
      const input = inPlace ? dummyInput : arg.wave;

      if (variant.kind === 'multiPass') {
        const { pipeline, tables } = createResources(device, variant, inPlace);
        const scratch = createScratchBuffers(
          device,
          variant,
          arg.config.windowCount,
        );

        return {
          kind: variant.kind,
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
            input,
          ),
          scratch,
          params,
          dummyInput,
          windowCount: arg.config.windowCount,
        };
      }

      const { pipeline, tables } = createResources(device, variant, inPlace);

      return {
        kind: variant.kind,
        variant,
        pipeline,
        tables,
        bindGroups: createSinglePassBindGroups(
          device,
          pipeline,
          tables,
          arg,
          params,
          input,
        ),
        params,
        dummyInput,
        windowCount: arg.config.windowCount,
      };
    },
    dispose: (state) => {
      state.params.buffer.destroy();
      state.dummyInput.destroy();
      if (state.kind === 'multiPass') {
        state.scratch.buffer0.destroy();
        state.scratch.buffer1.destroy();
      }
      disposeTrigTables(state.tables);
    },
    equals: (current, next) =>
      current.wave === next.wave &&
      current.spectrum === next.spectrum &&
      current.config.windowSize === next.config.windowSize &&
      current.config.windowCount === next.config.windowCount,
  });
