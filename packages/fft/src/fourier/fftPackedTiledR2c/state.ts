import { createResourceCell, type ResourceCell } from '@musetric/utils';
import { type FourierArg } from '../types.js';
import { createParamsRing, type ParamsRing } from './params.js';
import { createPipelines, type Pipelines } from './pipeline.js';
import {
  getPackedTiledR2cVariant,
  type PackedTiledR2cVariant,
} from './support.js';
import {
  createTrigTables,
  disposeTrigTables,
  type TrigTables,
} from './trigTables.js';

const batchSize = 4;

const createScratchBuffer = (
  device: GPUDevice,
  variant: PackedTiledR2cVariant,
  windowCount: number,
): GPUBuffer => {
  const byteSize =
    variant.packedWindowSize * windowCount * 2 * Float32Array.BYTES_PER_ELEMENT;

  return device.createBuffer({
    label: 'packed-tiled-r2c-scratch',
    size: byteSize,
    usage: GPUBufferUsage.STORAGE,
  });
};

type Resources = {
  pipelines: Pipelines;
  tables: TrigTables;
};

const createResources = (
  device: GPUDevice,
  variant: PackedTiledR2cVariant,
  inPlace: boolean,
): Resources => ({
  pipelines: createPipelines(device, variant, inPlace),
  tables: createTrigTables(device, variant),
});

const createDummyInputBuffer = (device: GPUDevice): GPUBuffer =>
  device.createBuffer({
    label: 'packed-tiled-r2c-dummy-input',
    size: Float32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.STORAGE,
  });

type CreateBindGroupsOptions = {
  input: GPUBuffer;
  params: GPUBufferBinding;
  pipelines: Pipelines;
  scratch: GPUBuffer;
  tables: TrigTables;
};

type BindGroups = {
  firstPass: GPUBindGroup;
  secondPass: GPUBindGroup;
};

const createBindGroups = (
  device: GPUDevice,
  arg: FourierArg,
  options: CreateBindGroupsOptions,
): BindGroups => ({
  firstPass: device.createBindGroup({
    label: 'packed-tiled-r2c-first-pass-bind-group',
    layout: options.pipelines.firstPass.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: options.input } },
      { binding: 1, resource: { buffer: arg.spectrum } },
      { binding: 2, resource: { buffer: options.scratch } },
      { binding: 3, resource: { buffer: options.tables.rowFft } },
      { binding: 4, resource: { buffer: options.tables.fourStep } },
      { binding: 5, resource: options.params },
    ],
  }),
  secondPass: device.createBindGroup({
    label: 'packed-tiled-r2c-second-pass-bind-group',
    layout: options.pipelines.secondPass.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: options.scratch } },
      { binding: 1, resource: { buffer: arg.spectrum } },
      { binding: 2, resource: { buffer: options.tables.columnFft } },
      { binding: 3, resource: { buffer: options.tables.r2c } },
      { binding: 4, resource: options.params },
    ],
  }),
});

const createSlotCache = <T>(
  build: (slot: number) => T,
): ((slot: number) => T) => {
  const cache = new Map<number, T>();
  return (slot) => {
    let cached = cache.get(slot);
    if (cached === undefined) {
      cached = build(slot);
      cache.set(slot, cached);
    }
    return cached;
  };
};

export type State = {
  pipelines: Pipelines;
  tables: TrigTables;
  getBindGroups: (slot: number) => BindGroups;
  params: ParamsRing;
  dummyInput: GPUBuffer;
  scratch: GPUBuffer;
  windowCount: number;
  firstPassXGroups: number;
  secondPassXGroups: number;
};

export const createStateCell = (
  device: GPUDevice,
): ResourceCell<FourierArg, State> =>
  createResourceCell({
    create: (arg): State => {
      const inPlace = arg.wave === arg.spectrum;
      const variant = getPackedTiledR2cVariant(device, arg.config);
      if (variant === undefined) {
        throw new Error(
          `fftPackedTiledR2c does not support windowSize=${arg.config.windowSize}`,
        );
      }
      const resources = createResources(device, variant, inPlace);
      const { pipelines, tables } = resources;
      const dummyInput = createDummyInputBuffer(device);
      const input = inPlace ? dummyInput : arg.wave;
      const scratch = createScratchBuffer(
        device,
        variant,
        arg.config.windowCount,
      );
      const params = createParamsRing(device, arg.config);

      return {
        pipelines,
        tables,
        getBindGroups: createSlotCache((slot) =>
          createBindGroups(device, arg, {
            input,
            params: params.binding(slot),
            pipelines,
            scratch,
            tables,
          }),
        ),
        params,
        dummyInput,
        scratch,
        windowCount: arg.config.windowCount,
        firstPassXGroups: Math.ceil(variant.columnSize / batchSize),
        secondPassXGroups: Math.ceil(variant.rowPairCount / batchSize),
      };
    },
    dispose: (state) => {
      state.params.destroy();
      state.dummyInput.destroy();
      state.scratch.destroy();
      disposeTrigTables(state.tables);
    },
    equals: (current, next) =>
      current.wave === next.wave &&
      current.spectrum === next.spectrum &&
      current.config.windowSize === next.config.windowSize &&
      current.config.windowCount === next.config.windowCount,
  });
