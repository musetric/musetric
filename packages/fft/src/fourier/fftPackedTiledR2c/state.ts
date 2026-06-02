import {
  createResourceCell,
  type ResourceCell,
} from '@musetric/resource-utils';
import { type ComplexGpuBuffer } from '@musetric/resource-utils/gpu';
import { type FourierConfig } from '../config.es.js';
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

export type StateArg = {
  signal: ComplexGpuBuffer;
  config: FourierConfig;
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
): Resources => ({
  pipelines: createPipelines(device, variant),
  tables: createTrigTables(device, variant),
});

export const createStateCell = (
  device: GPUDevice,
): ResourceCell<StateArg, State> =>
  createResourceCell({
    create: (arg): State => {
      const variant = getPackedTiledR2cVariant(device, arg.config);
      if (variant === undefined) {
        throw new Error(
          `fftPackedTiledR2c does not support windowSize=${arg.config.windowSize}`,
        );
      }
      const resources = createResources(device, variant);
      const { pipelines, tables } = resources;
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
            { binding: 0, resource: { buffer: arg.signal.real } },
            { binding: 1, resource: { buffer: scratch } },
            { binding: 2, resource: { buffer: tables.rowFft } },
            { binding: 3, resource: { buffer: tables.fourStep } },
            { binding: 4, resource: { buffer: params.buffer } },
          ],
        }),
        secondPass: device.createBindGroup({
          label: 'packed-tiled-r2c-second-pass-bind-group',
          layout: pipelines.secondPass.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: scratch } },
            { binding: 1, resource: { buffer: arg.signal.real } },
            { binding: 2, resource: { buffer: arg.signal.imag } },
            { binding: 3, resource: { buffer: tables.columnFft } },
            { binding: 4, resource: { buffer: tables.r2c } },
            { binding: 5, resource: { buffer: params.buffer } },
          ],
        }),
      };

      return {
        pipelines,
        tables,
        bindGroups,
        params,
        scratch,
        windowCount: arg.config.windowCount,
        firstPassXGroups: Math.ceil(variant.columnSize / batchSize),
        secondPassXGroups: Math.ceil(variant.rowPairCount / batchSize),
      };
    },
    dispose: (state) => {
      state.params.buffer.destroy();
      state.scratch.destroy();
      disposeTrigTables(state.tables);
    },
    equals: (current, next) =>
      current.signal.real === next.signal.real &&
      current.signal.imag === next.signal.imag &&
      current.config.windowSize === next.config.windowSize &&
      current.config.windowCount === next.config.windowCount,
  });
