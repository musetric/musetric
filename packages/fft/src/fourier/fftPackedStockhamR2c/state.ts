import {
  createResourceCell,
  type ResourceCell,
} from '@musetric/resource-utils';
import { type FourierArg } from '../types.js';
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

const assertInPlaceTransform = (arg: FourierArg): void => {
  if (arg.wave !== arg.spectrum.real) {
    throw new Error(
      'fftPackedStockhamR2c currently requires wave and spectrum.real to use the same buffer',
    );
  }
};

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
      const resources = createResources(device, variant);
      const { pipeline, tables } = resources;
      const params = createParams(device, arg.config);
      const bindGroup = device.createBindGroup({
        label: 'packed-stockham-r2c-transform-bind-group',
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: arg.spectrum.real } },
          { binding: 1, resource: { buffer: arg.spectrum.imag } },
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
      current.wave === next.wave &&
      current.spectrum.real === next.spectrum.real &&
      current.spectrum.imag === next.spectrum.imag &&
      current.config.windowSize === next.config.windowSize &&
      current.config.windowCount === next.config.windowCount,
  });
