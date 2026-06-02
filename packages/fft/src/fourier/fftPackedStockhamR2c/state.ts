import {
  createResourceCell,
  type ResourceCell,
} from '@musetric/resource-utils';
import { type ComplexGpuBuffer } from '@musetric/resource-utils/gpu';
import { type FourierConfig } from '../config.es.js';
import { createParams, type Params } from './params.js';
import { createPipeline } from './pipeline.js';
import {
  getPackedStockhamR2cVariant,
  type PackedStockhamR2cVariant,
} from './support.js';
import {
  createTrigTables,
  disposeTrigTables,
  type TrigTables,
} from './trigTables.js';

export type StateArg = {
  signal: ComplexGpuBuffer;
  config: FourierConfig;
};

type Resources = {
  pipeline: GPUComputePipeline;
  tables: TrigTables;
};

export type State = {
  pipeline: GPUComputePipeline;
  tables: TrigTables;
  bindGroup: GPUBindGroup;
  params: Params;
  windowCount: number;
};

const createResources = (
  device: GPUDevice,
  variant: PackedStockhamR2cVariant,
): Resources => ({
  pipeline: createPipeline(device, variant),
  tables: createTrigTables(device, variant),
});

export const createStateCell = (
  device: GPUDevice,
): ResourceCell<StateArg, State> =>
  createResourceCell({
    create: (arg): State => {
      const variant = getPackedStockhamR2cVariant(device, arg.config);
      if (variant === undefined) {
        throw new Error(
          `fftPackedStockhamR2c does not support windowSize=${arg.config.windowSize}`,
        );
      }
      const resources = createResources(device, variant);
      const { pipeline, tables } = resources;
      const params = createParams(device, arg.config);
      const bindGroup = device.createBindGroup({
        label: 'packed-stockham-r2c-transform-bind-group',
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: arg.signal.real } },
          { binding: 1, resource: { buffer: arg.signal.imag } },
          { binding: 2, resource: { buffer: tables.fft } },
          { binding: 3, resource: { buffer: tables.r2c } },
          { binding: 4, resource: { buffer: params.buffer } },
        ],
      });

      return {
        pipeline,
        tables,
        bindGroup,
        params,
        windowCount: arg.config.windowCount,
      };
    },
    dispose: (state) => {
      state.params.buffer.destroy();
      disposeTrigTables(state.tables);
    },
    equals: (current, next) =>
      current.signal.real === next.signal.real &&
      current.signal.imag === next.signal.imag &&
      current.config.windowSize === next.config.windowSize &&
      current.config.windowCount === next.config.windowCount,
  });
