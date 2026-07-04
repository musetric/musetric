import { createResourceCell, type ResourceCell } from '@musetric/utils';
import { type ExtSpectrogramConfig } from '../common/extConfig.js';
import { createParamsCell, type StateParams } from './params.js';
import { type FundamentalFrequencyPipelines } from './pipeline.js';

export type StateArg = {
  signal: GPUBuffer;
  config: ExtSpectrogramConfig;
};

export type FundamentalFrequencyState = {
  pipelines: FundamentalFrequencyPipelines;
  params: StateParams;
  output: {
    lattice: GPUBuffer;
    line: GPUBuffer;
  };
  bindGroups: {
    observe: GPUBindGroup;
    track: GPUBindGroup;
  };
};

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

export const createStateCell = (
  device: GPUDevice,
  pipelines: FundamentalFrequencyPipelines,
): ResourceCell<StateArg, FundamentalFrequencyState> => {
  const paramsCell = createParamsCell(device);
  const latticeCell = createLatticeBufferCell(device);
  const lineCell = createLineBufferCell(device);

  type ObserveBindGroupArg = {
    signal: GPUBuffer;
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
      const observeBindGroup = observeBindGroupCell.get({
        signal: arg.signal,
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
          lattice,
          line,
        },
        bindGroups: {
          observe: observeBindGroup,
          track: trackBindGroup,
        },
      };
    },
    dispose: () => {
      trackBindGroupCell.dispose();
      observeBindGroupCell.dispose();
      lineCell.dispose();
      latticeCell.dispose();
      paramsCell.dispose();
    },
  };
};
