import { createResourceCell, type ResourceCell } from '@musetric/utils';
import { type FourierArg } from '../types.js';
import { createParams, type Params } from './params.js';
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

type BindGroups = {
  firstPass: GPUBindGroup;
  secondPass: GPUBindGroup;
};

type Resources = {
  pipelines: Pipelines;
  tables: TrigTables;
};

export type State = {
  pipelines: Pipelines;
  tables: TrigTables;
  bindGroups: BindGroups;
  params: Params;
  dummyInput: GPUBuffer;
  scratch: GPUBuffer;
  windowCount: number;
  firstPassXGroups: number;
  secondPassXGroups: number;
};

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

const createResources = (
  device: GPUDevice,
  variant: PackedTiledR2cVariant,
  inPlace: boolean,
): Resources => ({
  pipelines: createPipelines(device, variant, inPlace),
  tables: createTrigTables(device, variant),
});

const createDummyInputBuffer = (device: GPUDevice): GPUBuffer => {
  return device.createBuffer({
    label: 'packed-tiled-r2c-dummy-input',
    size: Float32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.STORAGE,
  });
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
      const params = createParams(device, arg.config);
      const bindGroups = {
        firstPass: device.createBindGroup({
          label: 'packed-tiled-r2c-first-pass-bind-group',
          layout: pipelines.firstPass.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: input } },
            { binding: 1, resource: { buffer: arg.spectrum } },
            { binding: 2, resource: { buffer: scratch } },
            { binding: 3, resource: { buffer: tables.rowFft } },
            { binding: 4, resource: { buffer: tables.fourStep } },
            { binding: 5, resource: { buffer: params.buffer } },
          ],
        }),
        secondPass: device.createBindGroup({
          label: 'packed-tiled-r2c-second-pass-bind-group',
          layout: pipelines.secondPass.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: scratch } },
            { binding: 1, resource: { buffer: arg.spectrum } },
            { binding: 2, resource: { buffer: tables.columnFft } },
            { binding: 3, resource: { buffer: tables.r2c } },
            { binding: 4, resource: { buffer: params.buffer } },
          ],
        }),
      };

      return {
        pipelines,
        tables,
        bindGroups,
        params,
        dummyInput,
        scratch,
        windowCount: arg.config.windowCount,
        firstPassXGroups: Math.ceil(variant.columnSize / batchSize),
        secondPassXGroups: Math.ceil(variant.rowPairCount / batchSize),
      };
    },
    dispose: (state) => {
      state.params.buffer.destroy();
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
