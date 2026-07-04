import { createResourceCell, type ResourceCell } from '@musetric/utils';
import { type FourierArg } from '../types.js';
import { createParamsRing, type ParamsRing } from './params.js';
import {
  createPipeline,
  type MultiPassPipeline,
  type Pipeline,
  type SinglePassPipeline,
} from './pipeline.js';
import {
  getPackedStockhamC2rVariant,
  type PackedStockhamC2rVariant,
} from './support.js';
import {
  createTrigTables,
  disposeTrigTables,
  type TrigTables,
} from './trigTables.js';

const createDummySpectrumBuffer = (device: GPUDevice): GPUBuffer =>
  device.createBuffer({
    label: 'packed-stockham-c2r-dummy-spectrum',
    size: Float32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.STORAGE,
  });

type ScratchBuffers = {
  buffer0: GPUBuffer;
  buffer1: GPUBuffer;
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

type BaseState = {
  kind: Pipeline['kind'];
  variant: PackedStockhamC2rVariant;
  pipeline: Pipeline;
  tables: TrigTables;
  params: ParamsRing;
  windowCount: number;
  dummySpectrum: GPUBuffer;
};

type SinglePassState = BaseState & {
  kind: 'singlePass';
  pipeline: SinglePassPipeline;
  getBindGroup: (slot: number) => GPUBindGroup;
};

type MultiPassState = BaseState & {
  kind: 'multiPass';
  variant: Extract<PackedStockhamC2rVariant, { kind: 'multiPass' }>;
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
      const variant = getPackedStockhamC2rVariant(device, arg.config);
      if (variant === undefined) {
        throw new Error(
          `ifftPackedStockhamC2r does not support windowSize=${arg.config.windowSize}`,
        );
      }

      const inPlace = arg.wave === arg.spectrum;
      const pipeline = createPipeline(device, variant, inPlace);
      const tables = createTrigTables(device, variant);
      const params = createParamsRing(device, arg.config);
      const { windowCount } = arg.config;
      const dummySpectrum = createDummySpectrumBuffer(device);
      const spectrum = inPlace ? dummySpectrum : arg.spectrum;

      if (variant.kind === 'multiPass' && pipeline.kind === 'multiPass') {
        const scratch = createScratchBuffers(
          device,
          variant.packedWindowSize,
          windowCount,
        );

        return {
          kind: 'multiPass',
          variant,
          pipeline,
          tables,
          getStageBindGroups: createSlotCache((slot) =>
            pipeline.stages.map((stagePipeline) =>
              device.createBindGroup({
                label: 'packed-stockham-c2r-multipass-stage-bind-group',
                layout: stagePipeline.getBindGroupLayout(0),
                entries: [
                  { binding: 0, resource: { buffer: scratch.buffer0 } },
                  { binding: 1, resource: { buffer: scratch.buffer1 } },
                  { binding: 2, resource: { buffer: tables.fft } },
                  { binding: 3, resource: params.binding(slot) },
                  { binding: 4, resource: { buffer: spectrum } },
                  { binding: 5, resource: { buffer: arg.wave } },
                  { binding: 6, resource: { buffer: tables.r2c } },
                ],
              }),
            ),
          ),
          params,
          windowCount,
          dummySpectrum,
          scratch,
        };
      }

      if (pipeline.kind !== 'singlePass') {
        throw new Error('ifftPackedStockhamC2r variant/pipeline kind mismatch');
      }

      return {
        kind: 'singlePass',
        variant,
        pipeline,
        tables,
        getBindGroup: createSlotCache((slot) =>
          device.createBindGroup({
            label: 'packed-stockham-c2r-transform-bind-group',
            layout: pipeline.transform.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: { buffer: spectrum } },
              { binding: 1, resource: { buffer: arg.wave } },
              { binding: 2, resource: { buffer: tables.fft } },
              { binding: 3, resource: { buffer: tables.r2c } },
              { binding: 4, resource: params.binding(slot) },
            ],
          }),
        ),
        params,
        windowCount,
        dummySpectrum,
      };
    },
    dispose: (state) => {
      state.params.destroy();
      state.dummySpectrum.destroy();
      if (state.kind === 'multiPass') {
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
