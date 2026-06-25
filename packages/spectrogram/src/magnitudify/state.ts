import { createResourceCell, type ResourceCell } from '@musetric/utils';
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
  magnitude: GPUBuffer;
  bindGroup: GPUBindGroup;
};

export const createStateCell = (
  device: GPUDevice,
  pipelines: Pipelines,
): ResourceCell<StateArg, State> => {
  const paramsCell = createParamsCell(device);
  const magnitudeCell = createResourceCell({
    create: (params: StateParams): GPUBuffer => {
      const { windowSize, windowCount } = params.value;
      return device.createBuffer({
        label: 'magnitudify-magnitude-buffer',
        size: (windowSize / 2) * windowCount * Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
    },
    dispose: (buffer) => {
      buffer.destroy();
    },
    equals: (current, next) =>
      current.value.windowSize === next.value.windowSize &&
      current.value.windowCount === next.value.windowCount,
  });
  const bindGroupCell = createResourceCell({
    create: (arg: {
      signal: GPUBuffer;
      magnitude: GPUBuffer;
      params: GPUBuffer;
    }): GPUBindGroup =>
      device.createBindGroup({
        label: 'magnitudify-bind-group',
        layout: pipelines.layout,
        entries: [
          { binding: 0, resource: { buffer: arg.signal } },
          { binding: 1, resource: { buffer: arg.magnitude } },
          { binding: 2, resource: { buffer: arg.params } },
        ],
      }),
    dispose: () => undefined,
    equals: (current, next) =>
      current.signal === next.signal &&
      current.magnitude === next.magnitude &&
      current.params === next.params,
  });

  return {
    get: (arg) => {
      const { signal, config } = arg;
      const params = paramsCell.get(config);
      const magnitude = magnitudeCell.get(params);
      const bindGroup = bindGroupCell.get({
        signal,
        magnitude,
        params: params.buffer,
      });

      return {
        pipelines,
        config,
        params,
        magnitude,
        bindGroup,
      };
    },
    dispose: () => {
      bindGroupCell.dispose();
      magnitudeCell.dispose();
      paramsCell.dispose();
    },
  };
};
