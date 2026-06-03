import {
  createResourceCell,
  type ResourceCell,
} from '@musetric/resource-utils';
import { type FourierArg } from '../types.js';
import { createParams, type Params } from './params.js';
import { createPipeline } from './pipeline.js';
import {
  getPackedStockhamC2rVariant,
  type PackedStockhamC2rVariant,
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
  variant: PackedStockhamC2rVariant,
): Resources => ({
  pipeline: createPipeline(device, variant),
  tables: createTrigTables(device, variant),
});

export const createStateCell = (
  device: GPUDevice,
): ResourceCell<FourierArg, State> =>
  createResourceCell({
    create: (arg): State => {
      const variant = getPackedStockhamC2rVariant(device, arg.config);
      if (variant === undefined) {
        throw new Error(
          `ifftPackedStockhamC2r does not support windowSize=${arg.config.windowSize}`,
        );
      }

      const { pipeline, tables } = createResources(device, variant);
      const params = createParams(device, arg.config);
      const bindGroup = device.createBindGroup({
        label: 'packed-stockham-c2r-transform-bind-group',
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: arg.spectrum.real } },
          { binding: 1, resource: { buffer: arg.spectrum.imag } },
          { binding: 2, resource: { buffer: arg.wave } },
          { binding: 3, resource: { buffer: tables.fft } },
          { binding: 4, resource: { buffer: tables.r2c } },
          { binding: 5, resource: { buffer: params.buffer } },
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
      current.spectrum.real === next.spectrum.real &&
      current.spectrum.imag === next.spectrum.imag &&
      current.wave === next.wave &&
      current.config.windowSize === next.config.windowSize &&
      current.config.windowCount === next.config.windowCount,
  });
