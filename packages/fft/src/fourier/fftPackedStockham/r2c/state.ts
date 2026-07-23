import { createResourceCell, type ResourceCell } from '@musetric/utils';
import { createParamsRing, type ParamsRing } from '../../params.js';
import { createSlotCache } from '../../slotCache.js';
import { type FourierArg } from '../../types.js';
import { disposeTrigTables, type TrigTables } from '../trigTables.js';
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
import { createTrigTables } from './trigTables.js';

const createDummyInputBuffer = (device: GPUDevice): GPUBuffer =>
  device.createBuffer({
    label: 'packed-stockham-r2c-dummy-input',
    size: Float32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.STORAGE,
  });

type ScratchBuffers = {
  buffer0: GPUBuffer;
  buffer1: GPUBuffer;
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

type CreateSinglePassBindGroupOptions = {
  device: GPUDevice;
  pipeline: Extract<
    Pipeline,
    { kind: 'stockham' | 'inPlaceRadix4' | 'inPlaceMixed' }
  >;
  tables: TrigTables;
  arg: FourierArg;
  params: GPUBufferBinding;
  input: GPUBuffer;
};

const createSinglePassBindGroup = (
  options: CreateSinglePassBindGroupOptions,
): GPUBindGroup => {
  const { device, pipeline, tables, arg, params, input } = options;
  return device.createBindGroup({
    label: 'packed-stockham-r2c-transform-bind-group',
    layout: pipeline.transform.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: input } },
      { binding: 1, resource: { buffer: arg.spectrum } },
      { binding: 2, resource: { buffer: tables.fft } },
      { binding: 3, resource: { buffer: tables.r2c } },
      { binding: 4, resource: params },
    ],
  });
};

type CreateMultiPassStageBindGroupsOptions = {
  device: GPUDevice;
  variant: Extract<PackedStockhamR2cVariant, { kind: 'multiPass' }>;
  pipeline: Extract<Pipeline, { kind: 'multiPass' }>;
  tables: TrigTables;
  scratch: ScratchBuffers;
  arg: FourierArg;
  params: GPUBufferBinding;
  input: GPUBuffer;
};

const createMultiPassStageBindGroups = (
  options: CreateMultiPassStageBindGroupsOptions,
): GPUBindGroup[] => {
  const { device, variant, pipeline, tables, scratch, arg, params, input } =
    options;
  return pipeline.stages.map((stagePipeline, index) => {
    const entries: GPUBindGroupEntry[] = [
      { binding: 0, resource: { buffer: input } },
      { binding: 1, resource: { buffer: arg.spectrum } },
      { binding: 2, resource: { buffer: scratch.buffer0 } },
      { binding: 3, resource: { buffer: scratch.buffer1 } },
      { binding: 4, resource: { buffer: tables.fft } },
      { binding: 5, resource: params },
    ];
    if (variant.kernels[index].kind === 'single') {
      entries.push({ binding: 6, resource: { buffer: tables.r2c } });
    }
    return device.createBindGroup({
      label: 'packed-stockham-r2c-multipass-stage-bind-group',
      layout: stagePipeline.getBindGroupLayout(0),
      entries,
    });
  });
};

type BaseState = {
  kind: PackedStockhamR2cVariant['kind'];
  variant: PackedStockhamR2cVariant;
  pipeline: Pipeline;
  tables: TrigTables;
  params: ParamsRing;
  dummyInput: GPUBuffer;
  windowCount: number;
};

type SinglePassState = BaseState & {
  kind: 'stockham' | 'inPlaceRadix4' | 'inPlaceMixed';
  variant: Exclude<PackedStockhamR2cVariant, { kind: 'multiPass' }>;
  pipeline: SinglePassPipeline;
  getBindGroup: (slot: number) => GPUBindGroup;
};

type MultiPassState = BaseState & {
  kind: 'multiPass';
  variant: Extract<PackedStockhamR2cVariant, { kind: 'multiPass' }>;
  pipeline: MultiPassPipeline;
  getStageBindGroups: (slot: number) => GPUBindGroup[];
  scratch: ScratchBuffers;
};

export type State = SinglePassState | MultiPassState;

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
      const params = createParamsRing(
        device,
        arg.config,
        'packed-stockham-r2c-params',
      );
      const dummyInput = createDummyInputBuffer(device);
      const input = inPlace ? dummyInput : arg.wave;
      const pipeline = createPipeline(device, variant, inPlace);
      const tables = createTrigTables(device, variant);

      if (variant.kind === 'multiPass' && pipeline.kind === 'multiPass') {
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
          getStageBindGroups: createSlotCache((slot) =>
            createMultiPassStageBindGroups({
              device,
              variant,
              pipeline,
              tables,
              scratch,
              arg,
              params: params.binding(slot),
              input,
            }),
          ),
          scratch,
          params,
          dummyInput,
          windowCount: arg.config.windowCount,
        };
      }

      if (variant.kind === 'multiPass' || pipeline.kind === 'multiPass') {
        throw new Error('fftPackedStockhamR2c variant/pipeline kind mismatch');
      }

      return {
        kind: variant.kind,
        variant,
        pipeline,
        tables,
        getBindGroup: createSlotCache((slot) =>
          createSinglePassBindGroup({
            device,
            pipeline,
            tables,
            arg,
            params: params.binding(slot),
            input,
          }),
        ),
        params,
        dummyInput,
        windowCount: arg.config.windowCount,
      };
    },
    dispose: (state) => {
      state.params.destroy();
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
