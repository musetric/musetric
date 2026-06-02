import {
  createResourceCell,
  type ResourceCell,
} from '@musetric/resource-utils';
import { type SpectrogramConfig } from '../config.cross.js';
import { createParamsCell, type StateParams } from './params.js';

export type StateArg = {
  signal: GPUBuffer;
  texture: GPUTextureView;
  config: SpectrogramConfig;
};

export type State = {
  pipeline: GPUComputePipeline;
  config: SpectrogramConfig;
  params: StateParams;
  bindGroup: GPUBindGroup;
};

export const createStateCell = (
  device: GPUDevice,
  pipeline: GPUComputePipeline,
): ResourceCell<StateArg, State> => {
  const paramsCell = createParamsCell(device);
  const bindGroupCell = createResourceCell({
    create: (arg: {
      signal: GPUBuffer;
      texture: GPUTextureView;
      params: GPUBuffer;
    }): GPUBindGroup =>
      device.createBindGroup({
        label: 'remap-column-bind-group',
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: arg.signal } },
          { binding: 1, resource: arg.texture },
          { binding: 2, resource: { buffer: arg.params } },
        ],
      }),
    dispose: () => undefined,
    equals: (current, next) =>
      current.signal === next.signal &&
      current.texture === next.texture &&
      current.params === next.params,
  });

  return {
    get: (arg) => {
      const { signal, texture, config } = arg;
      const params = paramsCell.get(config);
      const bindGroup = bindGroupCell.get({
        signal,
        texture,
        params: params.buffer,
      });

      return {
        pipeline,
        config,
        params,
        bindGroup,
      };
    },
    dispose: () => {
      bindGroupCell.dispose();
      paramsCell.dispose();
    },
  };
};
