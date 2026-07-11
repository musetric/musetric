import { createResourceCell, type ResourceCell } from '@musetric/utils';
import { type ExtSpectrogramConfig } from '../common/extConfig.js';
import { createParamsCell, type StateParams } from './params.js';
import { type FundamentalFrequencyPipelines } from './pipeline.js';

type LatticeBufferArg = {
  windowCount: number;
  latticeCount: number;
};

const createLatticeBufferCell = (device: GPUDevice) =>
  createResourceCell({
    create: (arg: LatticeBufferArg): GPUBuffer =>
      device.createBuffer({
        label: 'fundamental-frequency-lattice-buffer',
        size:
          Math.max(1, arg.windowCount * arg.latticeCount) *
          2 *
          Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      }),
    dispose: (buffer) => {
      buffer.destroy();
    },
    equals: (current, next) =>
      current.windowCount === next.windowCount &&
      current.latticeCount === next.latticeCount,
  });

const createLineBufferCell = (device: GPUDevice) =>
  createResourceCell({
    create: (windowCount: number): GPUBuffer =>
      device.createBuffer({
        label: 'fundamental-frequency-line-buffer',
        size: Math.max(1, windowCount) * Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      }),
    dispose: (buffer) => {
      buffer.destroy();
    },
    equals: (current, next) => current === next,
  });

type PeriodicityBufferArg = {
  windowCount: number;
  lagCount: number;
};

const createPeriodicityBufferCell = (device: GPUDevice) =>
  createResourceCell({
    create: (arg: PeriodicityBufferArg): GPUBuffer =>
      device.createBuffer({
        label: 'fundamental-frequency-periodicity-buffer',
        size:
          Math.max(1, arg.windowCount * arg.lagCount) *
          Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      }),
    dispose: (buffer) => {
      buffer.destroy();
    },
    equals: (current, next) =>
      current.windowCount === next.windowCount &&
      current.lagCount === next.lagCount,
  });

export type StateArg = {
  signal: GPUBuffer;
  magnitude: GPUBuffer;
  config: ExtSpectrogramConfig;
};

export type FundamentalFrequencyState = {
  pipelines: FundamentalFrequencyPipelines;
  params: StateParams;
  output: {
    periodicity: GPUBuffer;
    lattice: GPUBuffer;
    line: GPUBuffer;
  };
  bindGroups: {
    autocorr: GPUBindGroup;
    observe: GPUBindGroup;
    track: GPUBindGroup;
  };
};

export const createStateCell = (
  device: GPUDevice,
  pipelines: FundamentalFrequencyPipelines,
): ResourceCell<StateArg, FundamentalFrequencyState> => {
  const paramsCell = createParamsCell(device);
  const latticeCell = createLatticeBufferCell(device);
  const lineCell = createLineBufferCell(device);
  const periodicityCell = createPeriodicityBufferCell(device);

  type AutocorrBindGroupArg = {
    magnitude: GPUBuffer;
    periodicity: GPUBuffer;
    params: StateParams;
  };
  const autocorrBindGroupCell = createResourceCell({
    create: (arg: AutocorrBindGroupArg): GPUBindGroup =>
      device.createBindGroup({
        label: 'fundamental-frequency-autocorr-bind-group',
        layout: pipelines.autocorr.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: arg.magnitude } },
          { binding: 1, resource: { buffer: arg.periodicity } },
          {
            binding: 2,
            resource: {
              buffer: arg.params.buffer,
              size: arg.params.byteLength,
            },
          },
        ],
      }),
    dispose: () => undefined,
    equals: (current, next) =>
      current.magnitude === next.magnitude &&
      current.periodicity === next.periodicity &&
      current.params === next.params,
  });
  type ObserveBindGroupArg = {
    signal: GPUBuffer;
    periodicity: GPUBuffer;
    lattice: GPUBuffer;
    params: StateParams;
  };
  const observeBindGroupCell = createResourceCell({
    create: (arg: ObserveBindGroupArg): GPUBindGroup =>
      device.createBindGroup({
        label: 'fundamental-frequency-observe-bind-group',
        layout: pipelines.observe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: arg.signal } },
          { binding: 1, resource: { buffer: arg.periodicity } },
          { binding: 2, resource: { buffer: arg.lattice } },
          {
            binding: 3,
            resource: {
              buffer: arg.params.buffer,
              size: arg.params.byteLength,
            },
          },
        ],
      }),
    dispose: () => undefined,
    equals: (current, next) =>
      current.signal === next.signal &&
      current.periodicity === next.periodicity &&
      current.lattice === next.lattice &&
      current.params === next.params,
  });
  type TrackBindGroupArg = {
    lattice: GPUBuffer;
    line: GPUBuffer;
    params: StateParams;
  };
  const trackBindGroupCell = createResourceCell({
    create: (arg: TrackBindGroupArg): GPUBindGroup =>
      device.createBindGroup({
        label: 'fundamental-frequency-track-bind-group',
        layout: pipelines.track.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: arg.lattice } },
          { binding: 1, resource: { buffer: arg.line } },
          {
            binding: 2,
            resource: {
              buffer: arg.params.buffer,
              size: arg.params.byteLength,
            },
          },
        ],
      }),
    dispose: () => undefined,
    equals: (current, next) =>
      current.lattice === next.lattice &&
      current.line === next.line &&
      current.params === next.params,
  });

  return {
    get: (arg) => {
      const params = paramsCell.get(arg.config);
      const lattice = latticeCell.get({
        windowCount: params.value.windowCount,
        latticeCount: params.value.latticeCount,
      });
      const line = lineCell.get(params.value.windowCount);
      const periodicity = periodicityCell.get({
        windowCount: params.value.windowCount,
        lagCount: params.value.lagCount,
      });
      const autocorrBindGroup = autocorrBindGroupCell.get({
        magnitude: arg.magnitude,
        periodicity,
        params,
      });
      const observeBindGroup = observeBindGroupCell.get({
        signal: arg.signal,
        periodicity,
        lattice,
        params,
      });
      const trackBindGroup = trackBindGroupCell.get({
        lattice,
        line,
        params,
      });

      return {
        pipelines,
        params,
        output: {
          periodicity,
          lattice,
          line,
        },
        bindGroups: {
          autocorr: autocorrBindGroup,
          observe: observeBindGroup,
          track: trackBindGroup,
        },
      };
    },
    dispose: () => {
      trackBindGroupCell.dispose();
      observeBindGroupCell.dispose();
      autocorrBindGroupCell.dispose();
      periodicityCell.dispose();
      lineCell.dispose();
      latticeCell.dispose();
      paramsCell.dispose();
    },
  };
};
