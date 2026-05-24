import {
  createResourceCell,
  type ResourceCell,
} from '@musetric/resource-utils';
import { type ComplexGpuBuffer } from '../../common/complexArray.js';
import { type FourierConfig } from '../config.js';
import { assertWindowSizePowerOfTwo } from '../isPowerOfTwo.js';
import {
  createSharedModule,
  createSharedPipeline,
  createTransformPipeline,
} from './pipeline.js';
import { utilsStockham } from './utils.js';

// ── Types ────────────────────────────────────────────────────────────────────

type PongBuffers = { real: GPUBuffer; imag: GPUBuffer };

export type SharedState = {
  kind: 'shared';
  pipeline: GPUComputePipeline;
  bindGroup: GPUBindGroup;
  windowSize: number;
  windowCount: number;
};

export type GlobalState = {
  kind: 'global';
  pipeline: GPUComputePipeline;
  bindGroups: GPUBindGroup[];
  log2N: number;
  windowSize: number;
  windowCount: number;
  pong: PongBuffers;
  needsCopy: boolean;
  signal: ComplexGpuBuffer;
};

export type State = SharedState | GlobalState;

export type StateArg = {
  signal: ComplexGpuBuffer;
  config: FourierConfig;
};

// ── Global-memory path resources ─────────────────────────────────────────────

type GlobalResources = {
  pong: PongBuffers;
  stageParams: GPUBuffer[];
  bindGroups: GPUBindGroup[];
  needsCopy: boolean;
};

type GlobalResourcesArg = {
  signal: ComplexGpuBuffer;
  config: FourierConfig;
  trigTable: GPUBuffer;
  pipeline: GPUComputePipeline;
};

const createGlobalResources = (
  device: GPUDevice,
  arg: GlobalResourcesArg,
): GlobalResources => {
  const { signal, config, trigTable, pipeline } = arg;
  const { windowSize, windowCount } = config;
  const log2N = Math.log2(windowSize);
  const byteSize = windowSize * windowCount * Float32Array.BYTES_PER_ELEMENT;

  const pong: PongBuffers = {
    real: device.createBuffer({
      label: 'stockham-pong-real',
      size: byteSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    }),
    imag: device.createBuffer({
      label: 'stockham-pong-imag',
      size: byteSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    }),
  };

  const stageParams: GPUBuffer[] = Array.from({ length: log2N }, (_, s) => {
    const stride = 1 << s;
    const array = new Uint32Array([windowSize, windowCount, stride]);
    const buf = device.createBuffer({
      label: `stockham-params-stage-${s}`,
      size: array.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(buf, 0, array);
    return buf;
  });

  const bindGroups: GPUBindGroup[] = Array.from({ length: log2N }, (_, s) => {
    const even = s % 2 === 0;
    return device.createBindGroup({
      label: `stockham-global-bg-stage-${s}`,
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: even ? signal.real : pong.real } },
        { binding: 1, resource: { buffer: even ? signal.imag : pong.imag } },
        { binding: 2, resource: { buffer: even ? pong.real : signal.real } },
        { binding: 3, resource: { buffer: even ? pong.imag : signal.imag } },
        { binding: 4, resource: { buffer: trigTable } },
        { binding: 5, resource: { buffer: stageParams[s] } },
      ],
    });
  });

  return { pong, stageParams, bindGroups, needsCopy: log2N % 2 !== 0 };
};

const disposeGlobalResources = (resources: GlobalResources) => {
  const { pong, stageParams } = resources;
  pong.real.destroy();
  pong.imag.destroy();
  for (const buf of stageParams) buf.destroy();
};

// ── Shared-memory path resources ─────────────────────────────────────────────

type SharedResources = { bindGroup: GPUBindGroup };

type SharedResourcesArg = {
  signal: ComplexGpuBuffer;
  trigTable: GPUBuffer;
  pipeline: GPUComputePipeline;
};

const createSharedResources = (
  device: GPUDevice,
  arg: SharedResourcesArg,
): SharedResources => {
  const { signal, trigTable, pipeline } = arg;
  return {
    bindGroup: device.createBindGroup({
      label: 'stockham-shared-bg',
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: signal.real } },
        { binding: 1, resource: { buffer: signal.imag } },
        { binding: 2, resource: { buffer: trigTable } },
      ],
    }),
  };
};

// ── State cell ────────────────────────────────────────────────────────────────

export const createStateCell = (
  device: GPUDevice,
): ResourceCell<StateArg, State> => {
  // Global-memory pipeline — static, shared across all configs.
  const globalPipeline = createTransformPipeline(device);

  // Shared-memory pipeline cache — one pipeline per windowSize (override constant).
  const sharedModule = createSharedModule(device);
  const sharedPipelineCache = new Map<number, GPUComputePipeline>();
  const getSharedPipeline = (windowSize: number): GPUComputePipeline => {
    let p = sharedPipelineCache.get(windowSize);
    if (!p) {
      p = createSharedPipeline(device, sharedModule, windowSize);
      sharedPipelineCache.set(windowSize, p);
    }
    return p;
  };

  // Maximum windowSize supported by shared memory on this device.
  // 4 f32 arrays of WINDOW_SIZE each = 16 bytes per element.
  const maxSharedWindowSize = Math.floor(
    device.limits.maxComputeWorkgroupStorageSize / 16,
  );

  // Trig table — shared by both paths, cached per windowSize.
  const trigTableCell = createResourceCell({
    create: (windowSize: number): GPUBuffer => {
      const array = utilsStockham.createTrigTable(windowSize);
      const buf = device.createBuffer({
        label: 'stockham-trig-table',
        size: array.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(buf, 0, array);
      return buf;
    },
    dispose: (buf) => buf.destroy(),
    equals: (a, b) => a === b,
  });

  // Global resources — cached per (signal, config, trigTable).
  const globalResourcesCell = createResourceCell<
    GlobalResourcesArg,
    GlobalResources
  >({
    create: (arg) => createGlobalResources(device, arg),
    dispose: disposeGlobalResources,
    equals: (c, n) =>
      c.signal.real === n.signal.real &&
      c.signal.imag === n.signal.imag &&
      c.config.windowSize === n.config.windowSize &&
      c.config.windowCount === n.config.windowCount &&
      c.trigTable === n.trigTable,
  });

  // Shared resources — cached per (signal, trigTable, pipeline).
  const sharedResourcesCell = createResourceCell<
    SharedResourcesArg,
    SharedResources
  >({
    create: (arg) => createSharedResources(device, arg),
    dispose: () => undefined,
    equals: (c, n) =>
      c.signal.real === n.signal.real &&
      c.signal.imag === n.signal.imag &&
      c.trigTable === n.trigTable &&
      c.pipeline === n.pipeline,
  });

  return {
    get: (arg): State => {
      const { signal, config } = arg;
      assertWindowSizePowerOfTwo(config.windowSize);
      const { windowSize, windowCount } = config;
      const trigTable = trigTableCell.get(windowSize);

      if (windowSize <= maxSharedWindowSize) {
        const pipeline = getSharedPipeline(windowSize);
        const { bindGroup } = sharedResourcesCell.get({
          signal,
          trigTable,
          pipeline,
        });
        return { kind: 'shared', pipeline, bindGroup, windowSize, windowCount };
      }

      const { pong, bindGroups, needsCopy } = globalResourcesCell.get({
        signal,
        config,
        trigTable,
        pipeline: globalPipeline,
      });
      return {
        kind: 'global',
        pipeline: globalPipeline,
        bindGroups,
        log2N: Math.log2(windowSize),
        windowSize,
        windowCount,
        pong,
        needsCopy,
        signal,
      };
    },
    dispose: () => {
      sharedResourcesCell.dispose();
      globalResourcesCell.dispose();
      trigTableCell.dispose();
    },
  };
};
