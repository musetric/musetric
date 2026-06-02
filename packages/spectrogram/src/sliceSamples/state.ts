import {
  createResourceCell,
  type ResourceCell,
} from '@musetric/resource-utils';
import { type ExtSpectrogramConfig } from '../common/extConfig.js';
import { createParamsCell, type StateParams } from './params.js';
import { createStateSamplesCell, type StateSamples } from './samples.js';

export type StateArg = {
  out: GPUBuffer;
  config: ExtSpectrogramConfig;
};

export type State = {
  pipeline: GPUComputePipeline;
  config: ExtSpectrogramConfig;
  params: StateParams;
  samples: StateSamples;
  bindGroup: GPUBindGroup;
};

export const createStateCell = (
  device: GPUDevice,
  pipeline: GPUComputePipeline,
): ResourceCell<StateArg, State> => {
  const paramsCell = createParamsCell(device);
  const samplesCell = createStateSamplesCell(device);
  const bindGroupCell = createResourceCell({
    create: (arg: {
      out: GPUBuffer;
      params: GPUBuffer;
      samples: GPUBuffer;
    }): GPUBindGroup =>
      device.createBindGroup({
        label: 'slice-samples-bind-group',
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: arg.samples } },
          { binding: 1, resource: { buffer: arg.out } },
          { binding: 2, resource: { buffer: arg.params } },
        ],
      }),
    dispose: () => undefined,
    equals: (current, next) =>
      current.out === next.out &&
      current.params === next.params &&
      current.samples === next.samples,
  });

  return {
    get: (arg) => {
      const { out, config } = arg;
      const params = paramsCell.get(config);
      const samples = samplesCell.get(params.value.visibleSamples);
      const bindGroup = bindGroupCell.get({
        out,
        params: params.buffer,
        samples: samples.buffer,
      });

      return {
        pipeline,
        config,
        params,
        samples,
        bindGroup,
      };
    },
    dispose: () => {
      bindGroupCell.dispose();
      samplesCell.dispose();
      paramsCell.dispose();
    },
  };
};
