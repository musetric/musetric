import {
  createResourceCell,
  type ResourceCell,
} from '@musetric/resource-utils';
import { type SpectrogramConfig } from '../config.cross.js';
import { createParamsCell, type StateParams } from './params.js';

export type StateArg = {
  rawMagnitude: GPUBuffer;
  columnEnergy: GPUBuffer;
  texture: GPUTextureView;
  config: SpectrogramConfig;
  gainDb: number;
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
      rawMagnitude: GPUBuffer;
      columnEnergy: GPUBuffer;
      texture: GPUTextureView;
      params: GPUBuffer;
    }): GPUBindGroup =>
      device.createBindGroup({
        label: 'remap-column-bind-group',
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: arg.rawMagnitude } },
          { binding: 1, resource: arg.texture },
          { binding: 2, resource: { buffer: arg.params } },
          { binding: 3, resource: { buffer: arg.columnEnergy } },
        ],
      }),
    dispose: () => undefined,
    equals: (current, next) =>
      current.rawMagnitude === next.rawMagnitude &&
      current.columnEnergy === next.columnEnergy &&
      current.texture === next.texture &&
      current.params === next.params,
  });

  return {
    get: (arg) => {
      const { rawMagnitude, columnEnergy, texture, config, gainDb } = arg;
      const params = paramsCell.get({ config, gainDb });
      const bindGroup = bindGroupCell.get({
        rawMagnitude,
        columnEnergy,
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
