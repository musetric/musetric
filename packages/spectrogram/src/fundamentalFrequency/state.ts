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
    raw: GPUBuffer;
    filtered: GPUBuffer;
  };
  bindGroups: {
    scoreAndPick: GPUBindGroup;
    filter: GPUBindGroup;
  };
};

const createFrequencyBufferCell = (device: GPUDevice, label: string) =>
  createResourceCell({
    create: (windowCount: number): GPUBuffer =>
      device.createBuffer({
        label,
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
  const rawOutputCell = createFrequencyBufferCell(
    device,
    'fundamental-frequency-raw-output-buffer',
  );
  const filteredOutputCell = createFrequencyBufferCell(
    device,
    'fundamental-frequency-filtered-output-buffer',
  );
  type ScoreAndPickBindGroupArg = {
    signal: GPUBuffer;
    rawOutput: GPUBuffer;
    params: StateParams;
  };
  const scoreAndPickBindGroupCell = createResourceCell({
    create: (arg: ScoreAndPickBindGroupArg): GPUBindGroup =>
      device.createBindGroup({
        label: 'fundamental-frequency-score-and-pick-bind-group',
        layout: pipelines.scoreAndPick.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: arg.signal } },
          { binding: 2, resource: { buffer: arg.rawOutput } },
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
      current.rawOutput === next.rawOutput &&
      current.params === next.params,
  });
  type FilterBindGroupArg = {
    rawOutput: GPUBuffer;
    filteredOutput: GPUBuffer;
    params: StateParams;
  };
  const filterBindGroupCell = createResourceCell({
    create: (arg: FilterBindGroupArg): GPUBindGroup =>
      device.createBindGroup({
        label: 'fundamental-frequency-filter-bind-group',
        layout: pipelines.filter.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: arg.rawOutput } },
          { binding: 1, resource: { buffer: arg.filteredOutput } },
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
      current.rawOutput === next.rawOutput &&
      current.filteredOutput === next.filteredOutput &&
      current.params === next.params,
  });

  return {
    get: (arg) => {
      const params = paramsCell.get(arg.config);
      const rawOutput = rawOutputCell.get(params.value.windowCount);
      const filteredOutput = filteredOutputCell.get(params.value.windowCount);
      const scoreAndPickBindGroup = scoreAndPickBindGroupCell.get({
        signal: arg.signal,
        rawOutput,
        params,
      });
      const filterBindGroup = filterBindGroupCell.get({
        rawOutput,
        filteredOutput,
        params,
      });

      return {
        pipelines,
        params,
        output: {
          raw: rawOutput,
          filtered: filteredOutput,
        },
        bindGroups: {
          scoreAndPick: scoreAndPickBindGroup,
          filter: filterBindGroup,
        },
      };
    },
    dispose: () => {
      filterBindGroupCell.dispose();
      scoreAndPickBindGroupCell.dispose();
      filteredOutputCell.dispose();
      rawOutputCell.dispose();
      paramsCell.dispose();
    },
  };
};
