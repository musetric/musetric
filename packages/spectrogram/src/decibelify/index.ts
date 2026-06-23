import { type ResourceCell } from '@musetric/resource-utils';
import { createPipelines } from './pipeline.js';
import { createStateCell, type StateArg } from './state.js';

const workgroupSize = 64;

export type SpectrogramDecibelify = {
  run: (encoder: GPUCommandEncoder) => void;
  dispatch: (pass: GPUComputePassEncoder) => void;
};

export const createSpectrogramDecibelifyCell = (
  device: GPUDevice,
  marker?: GPUComputePassTimestampWrites,
): ResourceCell<StateArg, SpectrogramDecibelify> => {
  const pipelines = createPipelines(device);
  const stateCell = createStateCell(device, pipelines);

  return {
    get: (arg) => {
      const state = stateCell.get(arg);

      const dispatch = (pass: GPUComputePassEncoder) => {
        const { halfSize, windowCount } = state.params.value;
        const xCount = Math.ceil(halfSize / workgroupSize);

        pass.setPipeline(state.pipelines.energy);
        pass.setBindGroup(0, state.bindGroup);
        pass.dispatchWorkgroups(windowCount);

        pass.setPipeline(state.pipelines.run);
        pass.setBindGroup(0, state.bindGroup);
        pass.dispatchWorkgroups(xCount, windowCount);
      };

      return {
        run: (encoder) => {
          const pass = encoder.beginComputePass({
            label: 'decibelify-pass',
            timestampWrites: marker,
          });
          dispatch(pass);
          pass.end();
        },
        dispatch,
      };
    },
    dispose: () => {
      stateCell.dispose();
    },
  };
};
