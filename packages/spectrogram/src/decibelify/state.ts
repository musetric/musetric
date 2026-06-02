import {
  createResourceCell,
  type ResourceCell,
} from '@musetric/resource-utils';
import { type ExtSpectrogramConfig } from '../common/extConfig.js';
import { createParamsCell, type StateParams } from './params.js';
import { type Pipelines } from './pipeline.js';

export type StateArg = {
  signal: GPUBuffer;
  config: ExtSpectrogramConfig;
};

export type State = {
  pipelines: Pipelines;
  config: ExtSpectrogramConfig;
  params: StateParams;
  bindGroup: GPUBindGroup;
};

export const createStateCell = (
  device: GPUDevice,
  pipelines: Pipelines,
): ResourceCell<StateArg, State> => {
  const paramsCell = createParamsCell(device);
  const bindGroupCell = createResourceCell({
    create: (arg: { signal: GPUBuffer; buffer: GPUBuffer }): GPUBindGroup =>
      device.createBindGroup({
        label: 'decibelify-bind-group',
        layout: pipelines.layout,
        entries: [
          { binding: 0, resource: { buffer: arg.signal } },
          { binding: 1, resource: { buffer: arg.buffer } },
        ],
      }),
    dispose: () => undefined,
    equals: (current, next) =>
      current.signal === next.signal && current.buffer === next.buffer,
  });

  return {
    get: (arg) => {
      const { signal, config } = arg;
      const params = paramsCell.get(config);
      const bindGroup = bindGroupCell.get({
        signal,
        buffer: params.buffer,
      });

      return {
        pipelines,
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
