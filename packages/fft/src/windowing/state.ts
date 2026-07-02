import { createResourceCell, type ResourceCell } from '@musetric/utils';
import { type FftWindowingConfig } from './config.js';
import { createParamsCell, type StateParams } from './params.js';
import {
  createWindowFunctionCell,
  type StateWindowFunction,
} from './windowFunction.js';

export type StateArg = {
  signal: GPUBuffer;
  config: FftWindowingConfig;
};

export type State = {
  pipeline: GPUComputePipeline;
  config: FftWindowingConfig;
  params: StateParams;
  windowFunction: StateWindowFunction;
  bindGroup: GPUBindGroup;
};

export const createStateCell = (
  device: GPUDevice,
  pipeline: GPUComputePipeline,
): ResourceCell<StateArg, State> => {
  const paramsCell = createParamsCell(device);
  const windowFunctionCell = createWindowFunctionCell(device);
  type WindowingBindGroupArg = {
    signal: GPUBuffer;
    params: GPUBuffer;
    windowFunction: GPUBuffer;
  };
  const bindGroupCell = createResourceCell({
    create: (arg: WindowingBindGroupArg): GPUBindGroup =>
      device.createBindGroup({
        label: 'windowing-bind-group',
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: arg.signal } },
          { binding: 1, resource: { buffer: arg.params } },
          { binding: 2, resource: { buffer: arg.windowFunction } },
        ],
      }),
    dispose: () => undefined,
    equals: (current, next) =>
      current.signal === next.signal &&
      current.params === next.params &&
      current.windowFunction === next.windowFunction,
  });

  return {
    get: (arg) => {
      const { signal, config } = arg;
      const params = paramsCell.get(config);
      const windowFunction = windowFunctionCell.get(config);
      const bindGroup = bindGroupCell.get({
        signal,
        params: params.buffer,
        windowFunction: windowFunction.buffer,
      });

      return {
        pipeline,
        config,
        params,
        windowFunction,
        bindGroup,
      };
    },
    dispose: () => {
      bindGroupCell.dispose();
      windowFunctionCell.dispose();
      paramsCell.dispose();
    },
  };
};
