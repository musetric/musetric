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
  scores: GPUBuffer;
  output: {
    raw: GPUBuffer;
    filtered: GPUBuffer;
  };
  bindGroups: {
    scoreCandidates: GPUBindGroup;
    pickBest: GPUBindGroup;
    filter: GPUBindGroup;
  };
};

type ScoresBufferArg = {
  windowCount: number;
  candidateCount: number;
};

const createScoresBufferCell = (device: GPUDevice) =>
  createResourceCell({
    create: (arg: ScoresBufferArg): GPUBuffer =>
      device.createBuffer({
        label: 'fundamental-frequency-scores-buffer',
        size:
          Math.max(1, arg.windowCount * arg.candidateCount) *
          Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      }),
    dispose: (buffer) => {
      buffer.destroy();
    },
    equals: (current, next) =>
      current.windowCount === next.windowCount &&
      current.candidateCount === next.candidateCount,
  });

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
  const scoresCell = createScoresBufferCell(device);
  const rawOutputCell = createFrequencyBufferCell(
    device,
    'fundamental-frequency-raw-output-buffer',
  );
  const filteredOutputCell = createFrequencyBufferCell(
    device,
    'fundamental-frequency-filtered-output-buffer',
  );
  const scoreCandidatesBindGroupCell = createResourceCell({
    create: (arg: {
      signal: GPUBuffer;
      scores: GPUBuffer;
      params: GPUBuffer;
    }): GPUBindGroup =>
      device.createBindGroup({
        label: 'fundamental-frequency-score-candidates-bind-group',
        layout: pipelines.scoreCandidates.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: arg.signal } },
          { binding: 1, resource: { buffer: arg.scores } },
          { binding: 3, resource: { buffer: arg.params } },
        ],
      }),
    dispose: () => undefined,
    equals: (current, next) =>
      current.signal === next.signal &&
      current.scores === next.scores &&
      current.params === next.params,
  });
  const pickBestBindGroupCell = createResourceCell({
    create: (arg: {
      signal: GPUBuffer;
      scores: GPUBuffer;
      rawOutput: GPUBuffer;
      params: GPUBuffer;
    }): GPUBindGroup =>
      device.createBindGroup({
        label: 'fundamental-frequency-pick-best-bind-group',
        layout: pipelines.pickBest.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: arg.signal } },
          { binding: 1, resource: { buffer: arg.scores } },
          { binding: 2, resource: { buffer: arg.rawOutput } },
          { binding: 3, resource: { buffer: arg.params } },
        ],
      }),
    dispose: () => undefined,
    equals: (current, next) =>
      current.signal === next.signal &&
      current.scores === next.scores &&
      current.rawOutput === next.rawOutput &&
      current.params === next.params,
  });
  const filterBindGroupCell = createResourceCell({
    create: (arg: {
      rawOutput: GPUBuffer;
      filteredOutput: GPUBuffer;
      params: GPUBuffer;
    }): GPUBindGroup =>
      device.createBindGroup({
        label: 'fundamental-frequency-filter-bind-group',
        layout: pipelines.filter.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: arg.rawOutput } },
          { binding: 1, resource: { buffer: arg.filteredOutput } },
          { binding: 2, resource: { buffer: arg.params } },
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
      const scores = scoresCell.get({
        windowCount: params.value.windowCount,
        candidateCount: params.value.candidateCount,
      });
      const rawOutput = rawOutputCell.get(params.value.windowCount);
      const filteredOutput = filteredOutputCell.get(params.value.windowCount);
      const scoreCandidatesBindGroup = scoreCandidatesBindGroupCell.get({
        signal: arg.signal,
        scores,
        params: params.buffer,
      });
      const pickBestBindGroup = pickBestBindGroupCell.get({
        signal: arg.signal,
        scores,
        rawOutput,
        params: params.buffer,
      });
      const filterBindGroup = filterBindGroupCell.get({
        rawOutput,
        filteredOutput,
        params: params.buffer,
      });

      return {
        pipelines,
        params,
        scores,
        output: {
          raw: rawOutput,
          filtered: filteredOutput,
        },
        bindGroups: {
          scoreCandidates: scoreCandidatesBindGroup,
          pickBest: pickBestBindGroup,
          filter: filterBindGroup,
        },
      };
    },
    dispose: () => {
      filterBindGroupCell.dispose();
      pickBestBindGroupCell.dispose();
      scoreCandidatesBindGroupCell.dispose();
      filteredOutputCell.dispose();
      rawOutputCell.dispose();
      scoresCell.dispose();
      paramsCell.dispose();
    },
  };
};
