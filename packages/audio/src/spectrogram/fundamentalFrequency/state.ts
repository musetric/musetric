import {
  createResourceCell,
  type ResourceCell,
} from '@musetric/resource-utils';
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
    detect: GPUBindGroup;
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
  const detectBindGroupCell = createResourceCell({
    create: (arg: {
      signal: GPUBuffer;
      params: GPUBuffer;
      output: GPUBuffer;
    }): GPUBindGroup =>
      device.createBindGroup({
        label: 'fundamental-frequency-bind-group',
        layout: pipelines.detect.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: arg.signal } },
          { binding: 1, resource: { buffer: arg.output } },
          { binding: 2, resource: { buffer: arg.params } },
        ],
      }),
    dispose: () => undefined,
    equals: (current, next) =>
      current.signal === next.signal &&
      current.output === next.output &&
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
      const rawOutput = rawOutputCell.get(params.value.windowCount);
      const filteredOutput = filteredOutputCell.get(params.value.windowCount);
      const detectBindGroup = detectBindGroupCell.get({
        signal: arg.signal,
        output: rawOutput,
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
        output: {
          raw: rawOutput,
          filtered: filteredOutput,
        },
        bindGroups: {
          detect: detectBindGroup,
          filter: filterBindGroup,
        },
      };
    },
    dispose: () => {
      filterBindGroupCell.dispose();
      detectBindGroupCell.dispose();
      filteredOutputCell.dispose();
      rawOutputCell.dispose();
      paramsCell.dispose();
    },
  };
};
