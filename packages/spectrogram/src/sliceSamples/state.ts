import { createResourceCell, type ResourceCell } from '@musetric/utils';
import { type ExtSpectrogramConfig } from '../common/extConfig.js';
import { createParamsCell, type StateParams } from './params.js';
import { createStateSamplesCell, type StateSamples } from './samples.js';
import {
  createWindowFunctionCell,
  type StateWindowFunction,
} from './windowFunction.js';

export type StateArg = {
  out: GPUBuffer;
  config: ExtSpectrogramConfig;
};

export type State = {
  pipeline: GPUComputePipeline;
  config: ExtSpectrogramConfig;
  out: GPUBuffer;
  params: StateParams;
  samples: StateSamples;
  windowFunction: StateWindowFunction;
  bindGroup: GPUBindGroup;
};

export const createStateCell = (
  device: GPUDevice,
  pipeline: GPUComputePipeline,
): ResourceCell<StateArg, State> => {
  const paramsCell = createParamsCell(device);
  const samplesCell = createStateSamplesCell(device);
  const windowFunctionCell = createWindowFunctionCell(device);
  const bindGroupCell = createResourceCell({
    create: (arg: {
      out: GPUBuffer;
      params: StateParams;
      samples: GPUBuffer;
      windowFunction: GPUBuffer;
    }): GPUBindGroup =>
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
        ],
      }),
    dispose: () => undefined,
    equals: (current, next) =>
      current.out === next.out &&
      current.params === next.params &&
      current.samples === next.samples &&
      current.windowFunction === next.windowFunction,
  });

  return {
    get: (arg) => {
      const { out, config } = arg;
      const params = paramsCell.get(config);
      const samples = samplesCell.get(params.value.visibleSamples);
      const windowFunction = windowFunctionCell.get(config);
      const bindGroup = bindGroupCell.get({
        out,
        params,
        samples: samples.buffer,
        windowFunction: windowFunction.buffer,
      });

      return {
        pipeline,
        config,
        out,
        params,
        samples,
        windowFunction,
        bindGroup,
      };
    },
    dispose: () => {
      bindGroupCell.dispose();
      windowFunctionCell.dispose();
      samplesCell.dispose();
      paramsCell.dispose();
    },
  };
};
