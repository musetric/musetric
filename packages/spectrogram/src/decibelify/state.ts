import { createResourceCell, type ResourceCell } from '@musetric/utils';
import { type ExtSpectrogramConfig } from '../common/extConfig.js';
import { createParamsCell, type StateParams } from './params.js';
import { type Pipelines } from './pipeline.js';

export type StateArg = {
  signal: GPUBuffer;
  magnitude: GPUBuffer;
  config: ExtSpectrogramConfig;
  gainDb: number;
};

export type State = {
  pipelines: Pipelines;
  config: ExtSpectrogramConfig;
  params: StateParams;
  columnEnergy: GPUBuffer;
  bindGroup: GPUBindGroup;
};

export const createStateCell = (
  device: GPUDevice,
  pipelines: Pipelines,
): ResourceCell<StateArg, State> => {
  const paramsCell = createParamsCell(device);
  const columnEnergyCell = createResourceCell({
    create: (params: StateParams): GPUBuffer =>
      device.createBuffer({
        label: 'decibelify-column-energy-buffer',
        size: params.value.windowCount * Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      }),
    dispose: (buffer) => {
      buffer.destroy();
    },
    equals: (current, next) =>
      current.value.windowCount === next.value.windowCount,
  });
  const bindGroupCell = createResourceCell({
    create: (arg: {
      signal: GPUBuffer;
      magnitude: GPUBuffer;
      params: GPUBuffer;
      columnEnergy: GPUBuffer;
    }): GPUBindGroup =>
      device.createBindGroup({
        label: 'decibelify-bind-group',
        layout: pipelines.layout,
        entries: [
          { binding: 0, resource: { buffer: arg.magnitude } },
          { binding: 1, resource: { buffer: arg.params } },
          { binding: 2, resource: { buffer: arg.columnEnergy } },
          { binding: 3, resource: { buffer: arg.signal } },
        ],
      }),
    dispose: () => undefined,
    equals: (current, next) =>
      current.signal === next.signal &&
      current.magnitude === next.magnitude &&
      current.params === next.params &&
      current.columnEnergy === next.columnEnergy,
  });

  return {
    get: (arg) => {
      const { signal, magnitude, config } = arg;
      const params = paramsCell.get({
        config,
        gainDb: arg.gainDb,
      });
      const columnEnergy = columnEnergyCell.get(params);
      const bindGroup = bindGroupCell.get({
        signal,
        magnitude,
        params: params.buffer,
        columnEnergy,
      });

      return {
        pipelines,
        config,
        params,
        columnEnergy,
        bindGroup,
      };
    },
    dispose: () => {
      bindGroupCell.dispose();
      columnEnergyCell.dispose();
      paramsCell.dispose();
    },
  };
};
