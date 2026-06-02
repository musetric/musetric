import {
  createResourceCell,
  type ResourceCell,
} from '@musetric/resource-utils';
import { type ComplexGpuBuffer } from '@musetric/resource-utils/gpu';
import { type ExtSpectrogramConfig } from '../common/extConfig.js';
import { createParamsCell, type StateParams } from './params.js';
import { type Pipelines } from './pipeline.js';

export type StateArg = {
  signal: ComplexGpuBuffer;
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
    create: (arg: {
      real: GPUBuffer;
      imag: GPUBuffer;
      params: GPUBuffer;
    }): GPUBindGroup =>
      device.createBindGroup({
        label: 'magnitudify-bind-group',
        layout: pipelines.layout,
        entries: [
          { binding: 0, resource: { buffer: arg.real } },
          { binding: 1, resource: { buffer: arg.imag } },
          { binding: 2, resource: { buffer: arg.params } },
        ],
      }),
    dispose: () => undefined,
    equals: (current, next) =>
      current.real === next.real &&
      current.imag === next.imag &&
      current.params === next.params,
  });

  return {
    get: (arg) => {
      const { signal, config } = arg;
      const params = paramsCell.get(config);
      const bindGroup = bindGroupCell.get({
        real: signal.real,
        imag: signal.imag,
        params: params.buffer,
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
