import {
  createResourceCell,
  type ResourceCell,
} from '@musetric/resource-utils';
import { type FourierArg } from '../types.js';
import { createParams, type Params } from './params.js';
import { createPipeline, type Pipeline } from './pipeline.js';
import {
  getPackedStockhamC2rVariant,
  type PackedStockhamC2rVariant,
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
  kind: 'singlePass';
  transform: GPUBindGroup;
};

type MultiPassBindGroups = {
  kind: 'multiPass';
  prepack: GPUBindGroup;
  stages: GPUBindGroup[];
  unpack: GPUBindGroup;
};

type BindGroups = SinglePassBindGroups | MultiPassBindGroups;

export type State = {
  variant: PackedStockhamC2rVariant;
  pipeline: Pipeline;
  tables: TrigTables;
  bindGroups: BindGroups;
  params: Params;
  windowCount: number;
  scratch?: ScratchBuffers;
};

const createScratchBuffers = (
  device: GPUDevice,
  packedWindowSize: number,
  windowCount: number,
): ScratchBuffers => {
  const size =
    windowCount * packedWindowSize * 2 * Float32Array.BYTES_PER_ELEMENT;
  return {
    buffer0: device.createBuffer({
      label: 'packed-stockham-c2r-multipass-scratch-0',
      size,
      usage: GPUBufferUsage.STORAGE,
    }),
    buffer1: device.createBuffer({
      label: 'packed-stockham-c2r-multipass-scratch-1',
      size,
      usage: GPUBufferUsage.STORAGE,
    }),
  };
};

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

      const pipeline = createPipeline(device, variant);
      const tables = createTrigTables(device, variant);
      const params = createParams(device, arg.config);
      const { windowCount } = arg.config;

      if (pipeline.kind === 'multiPass') {
        const scratch = createScratchBuffers(
          device,
          variant.packedWindowSize,
          windowCount,
        );
        const bindGroups: MultiPassBindGroups = {
          kind: 'multiPass',
          prepack: device.createBindGroup({
            label: 'packed-stockham-c2r-multipass-prepack-bind-group',
            layout: pipeline.prepack.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: { buffer: arg.spectrum.real } },
              { binding: 1, resource: { buffer: arg.spectrum.imag } },
              { binding: 2, resource: { buffer: scratch.buffer0 } },
              { binding: 3, resource: { buffer: scratch.buffer1 } },
              { binding: 4, resource: { buffer: tables.r2c } },
              { binding: 5, resource: { buffer: params.buffer } },
            ],
          }),
          stages: pipeline.stages.map((stagePipeline) =>
            device.createBindGroup({
              label: 'packed-stockham-c2r-multipass-stage-bind-group',
              layout: stagePipeline.getBindGroupLayout(0),
              entries: [
                { binding: 0, resource: { buffer: scratch.buffer0 } },
                { binding: 1, resource: { buffer: scratch.buffer1 } },
                { binding: 2, resource: { buffer: tables.fft } },
                { binding: 3, resource: { buffer: params.buffer } },
              ],
            }),
          ),
          unpack: device.createBindGroup({
            label: 'packed-stockham-c2r-multipass-unpack-bind-group',
            layout: pipeline.unpack.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: { buffer: arg.wave } },
              { binding: 1, resource: { buffer: scratch.buffer0 } },
              { binding: 2, resource: { buffer: scratch.buffer1 } },
              { binding: 3, resource: { buffer: params.buffer } },
            ],
          }),
        };

        return {
          variant,
          pipeline,
          tables,
          bindGroups,
          params,
          windowCount,
          scratch,
        };
      }

      const bindGroups: SinglePassBindGroups = {
        kind: 'singlePass',
        transform: device.createBindGroup({
          label: 'packed-stockham-c2r-transform-bind-group',
          layout: pipeline.transform.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: arg.spectrum.real } },
            { binding: 1, resource: { buffer: arg.spectrum.imag } },
            { binding: 2, resource: { buffer: arg.wave } },
            { binding: 3, resource: { buffer: tables.fft } },
            { binding: 4, resource: { buffer: tables.r2c } },
            { binding: 5, resource: { buffer: params.buffer } },
          ],
        }),
      };

      return {
        variant,
        pipeline,
        tables,
        bindGroups,
        params,
        windowCount,
      };
    },
    dispose: (state) => {
      state.params.buffer.destroy();
      if (state.scratch) {
        state.scratch.buffer0.destroy();
        state.scratch.buffer1.destroy();
      }
      disposeTrigTables(state.tables);
    },
    equals: (current, next) =>
      current.spectrum.real === next.spectrum.real &&
      current.spectrum.imag === next.spectrum.imag &&
      current.wave === next.wave &&
      current.config.windowSize === next.config.windowSize &&
      current.config.windowCount === next.config.windowCount,
  });
