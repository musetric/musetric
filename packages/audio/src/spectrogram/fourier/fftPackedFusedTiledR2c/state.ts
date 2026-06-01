import {
  createResourceCell,
  type ResourceCell,
} from '@musetric/resource-utils';
import { type ComplexGpuBuffer } from '@musetric/resource-utils/gpu';
import { type FourierConfig } from '../config.js';
import { createParams, type Params } from './params.js';
import { createPipelines, type Pipelines } from './pipeline.js';
import {
  getPackedFusedTiledR2cVariant,
  type PackedFusedTiledR2cVariant,
} from './support.js';
import {
  createTrigTables,
  disposeTrigTables,
  type TrigTables,
} from './trigTables.js';

type FusedBindGroups = {
  kind: 'fused';
  transform: GPUBindGroup;
};

type FusedInPlaceBindGroups = {
  kind: 'fusedInPlace';
  transform: GPUBindGroup;
};

type BindGroups = FusedBindGroups | FusedInPlaceBindGroups;

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
  windowCount: number;
};

const createResources = (
  device: GPUDevice,
  variant: PackedFusedTiledR2cVariant,
): Resources => ({
  pipelines: createPipelines(device, variant),
  tables: createTrigTables(device, variant),
});

const createFusedBindGroups = (
  device: GPUDevice,
  pipelines: Extract<Pipelines, { kind: 'fused' }>,
  tables: TrigTables,
  signal: ComplexGpuBuffer,
  params: Params,
): FusedBindGroups => ({
  kind: 'fused',
  transform: device.createBindGroup({
    label: 'packed-fused-tiled-r2c-fused-bind-group',
    layout: pipelines.transform.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: signal.real } },
      { binding: 1, resource: { buffer: signal.imag } },
      { binding: 2, resource: { buffer: tables.rowFft } },
      { binding: 3, resource: { buffer: tables.columnFft } },
      { binding: 4, resource: { buffer: tables.fourStep } },
      { binding: 5, resource: { buffer: tables.r2c } },
      { binding: 6, resource: { buffer: params.buffer } },
    ],
  }),
});

const createFusedInPlaceBindGroups = (
  device: GPUDevice,
  pipelines: Extract<Pipelines, { kind: 'fusedInPlace' }>,
  tables: TrigTables,
  signal: ComplexGpuBuffer,
  params: Params,
): FusedInPlaceBindGroups => ({
  kind: 'fusedInPlace',
  transform: device.createBindGroup({
    label: 'packed-fused-tiled-r2c-fused-inplace-bind-group',
    layout: pipelines.transform.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: signal.real } },
      { binding: 1, resource: { buffer: signal.imag } },
      { binding: 2, resource: { buffer: tables.rowFft } },
      { binding: 3, resource: { buffer: tables.columnFft } },
      { binding: 4, resource: { buffer: tables.fourStep } },
      { binding: 5, resource: { buffer: tables.r2c } },
      { binding: 6, resource: { buffer: params.buffer } },
    ],
  }),
});

const createBindGroups = (
  device: GPUDevice,
  pipelines: Pipelines,
  tables: TrigTables,
  signal: ComplexGpuBuffer,
  params: Params,
): BindGroups => {
  if (pipelines.kind === 'fused') {
    return createFusedBindGroups(device, pipelines, tables, signal, params);
  }
  return createFusedInPlaceBindGroups(
    device,
    pipelines,
    tables,
    signal,
    params,
  );
};

export const createStateCell = (
  device: GPUDevice,
): ResourceCell<StateArg, State> =>
  createResourceCell({
    create: (arg): State => {
      const variant = getPackedFusedTiledR2cVariant(device, arg.config);
      if (variant === undefined) {
        throw new Error(
          `fftPackedFusedTiledR2c does not support windowSize=${arg.config.windowSize}`,
        );
      }
      const resources = createResources(device, variant);
      const { pipelines, tables } = resources;
      const params = createParams(device, arg.config);
      const bindGroups = createBindGroups(
        device,
        pipelines,
        tables,
        arg.signal,
        params,
      );

      return {
        pipelines,
        tables,
        bindGroups,
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
