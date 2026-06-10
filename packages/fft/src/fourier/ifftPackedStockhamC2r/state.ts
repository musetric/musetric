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
  stages: GPUBindGroup[];
};

type BindGroups = SinglePassBindGroups | MultiPassBindGroups;

export type State = {
  variant: PackedStockhamC2rVariant;
  pipeline: Pipeline;
  tables: TrigTables;
  bindGroups: BindGroups;
  params: Params;
  windowCount: number;
  dummySpectrum: GPUBuffer;
  scratch?: ScratchBuffers;
};

const createDummySpectrumBuffer = (device: GPUDevice): GPUBuffer => {
  return device.createBuffer({
    label: 'packed-stockham-c2r-dummy-spectrum',
    size: Float32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.STORAGE,
  });
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

      const inPlace = arg.wave === arg.spectrum;
      const pipeline = createPipeline(device, variant, inPlace);
      const tables = createTrigTables(device, variant);
      const params = createParams(device, arg.config);
      const { windowCount } = arg.config;
      const dummySpectrum = createDummySpectrumBuffer(device);
      const spectrum = inPlace ? dummySpectrum : arg.spectrum;

      if (pipeline.kind === 'multiPass') {
        const scratch = createScratchBuffers(
          device,
          variant.packedWindowSize,
          windowCount,
        );
        const bindGroups: MultiPassBindGroups = {
          kind: 'multiPass',
          stages: pipeline.stages.map((stagePipeline) =>
            device.createBindGroup({
              label: 'packed-stockham-c2r-multipass-stage-bind-group',
              layout: stagePipeline.getBindGroupLayout(0),
              entries: [
                { binding: 0, resource: { buffer: scratch.buffer0 } },
                { binding: 1, resource: { buffer: scratch.buffer1 } },
                { binding: 2, resource: { buffer: tables.fft } },
                { binding: 3, resource: { buffer: params.buffer } },
                { binding: 4, resource: { buffer: spectrum } },
                { binding: 5, resource: { buffer: arg.wave } },
                { binding: 6, resource: { buffer: tables.r2c } },
              ],
            }),
          ),
        };

        return {
          variant,
          pipeline,
          tables,
          bindGroups,
          params,
          windowCount,
          dummySpectrum,
          scratch,
        };
      }

      const bindGroups: SinglePassBindGroups = {
        kind: 'singlePass',
        transform: device.createBindGroup({
          label: 'packed-stockham-c2r-transform-bind-group',
          layout: pipeline.transform.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: spectrum } },
            { binding: 1, resource: { buffer: arg.wave } },
            { binding: 2, resource: { buffer: tables.fft } },
            { binding: 3, resource: { buffer: tables.r2c } },
            { binding: 4, resource: { buffer: params.buffer } },
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
        dummySpectrum,
      };
    },
    dispose: (state) => {
      state.params.buffer.destroy();
      state.dummySpectrum.destroy();
      if (state.scratch) {
        state.scratch.buffer0.destroy();
        state.scratch.buffer1.destroy();
      }
      disposeTrigTables(state.tables);
    },
    equals: (current, next) =>
      current.spectrum === next.spectrum &&
      current.wave === next.wave &&
      current.config.windowSize === next.config.windowSize &&
      current.config.windowCount === next.config.windowCount,
  });
