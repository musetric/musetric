import { createResourceCell, type ResourceCell } from '@musetric/utils';
import { type ExtSpectrogramConfig } from '../common/extConfig.js';
import { createParamsCell, type StateParams } from './params.js';
import { type StateSamples } from './samples.js';
import {
  createWindowFunctionCell,
  type StateWindowFunction,
} from './windowFunction.js';

export type StateArg = {
  out: GPUBuffer;
  config: ExtSpectrogramConfig;
  samples: StateSamples;
};

export type State = {
  pipeline: GPUComputePipeline;
  config: ExtSpectrogramConfig;
  out: GPUBuffer;
  params: StateParams;
  samples: StateSamples;
  columnOffsets: GPUBuffer;
  windowFunction: StateWindowFunction;
  bindGroup: GPUBindGroup;
};

export const createStateCell = (
  device: GPUDevice,
  pipeline: GPUComputePipeline,
): ResourceCell<StateArg, State> => {
  const paramsCell = createParamsCell(device);
  const columnOffsetsCell = createResourceCell({
    create: (windowCount: number): GPUBuffer =>
      device.createBuffer({
        label: 'slice-samples-column-offsets-buffer',
        size: windowCount * Int32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      }),
    dispose: (buffer) => {
      buffer.destroy();
    },
    equals: (current, next) => current === next,
  });
  const windowFunctionCell = createWindowFunctionCell(device);
  type SliceSamplesBindGroupArg = {
    out: GPUBuffer;
    params: StateParams;
    samples: GPUBuffer;
    columnOffsets: GPUBuffer;
    windowFunction: GPUBuffer;
  };
  const bindGroupCell = createResourceCell({
    create: (arg: SliceSamplesBindGroupArg): GPUBindGroup =>
      device.createBindGroup({
        label: 'slice-samples-bind-group',
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: arg.samples } },
          { binding: 1, resource: { buffer: arg.out } },
          {
            binding: 2,
            resource: {
              buffer: arg.params.buffer,
              size: arg.params.byteLength,
            },
          },
          { binding: 3, resource: { buffer: arg.windowFunction } },
          { binding: 4, resource: { buffer: arg.columnOffsets } },
        ],
      }),
    dispose: () => undefined,
    equals: (current, next) =>
      current.out === next.out &&
      current.params === next.params &&
      current.samples === next.samples &&
      current.columnOffsets === next.columnOffsets &&
      current.windowFunction === next.windowFunction,
  });

  return {
    get: (arg) => {
      const { out, config, samples } = arg;
      const params = paramsCell.get(config);
      const columnOffsets = columnOffsetsCell.get(params.value.windowCount);
      const windowFunction = windowFunctionCell.get(config);
      const bindGroup = bindGroupCell.get({
        out,
        params,
        samples: samples.buffer,
        columnOffsets,
        windowFunction: windowFunction.buffer,
      });

      return {
        pipeline,
        config,
        out,
        params,
        samples,
        columnOffsets,
        windowFunction,
        bindGroup,
      };
    },
    dispose: () => {
      bindGroupCell.dispose();
      windowFunctionCell.dispose();
      columnOffsetsCell.dispose();
      paramsCell.dispose();
    },
  };
};
