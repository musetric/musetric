import type { ResourceCell } from '@musetric/resource-utils';
import { createPipeline } from './pipeline.js';
import { createStateCell, type StateArg } from './state.js';

const workgroupSize = 64;

export type SpectrogramWindowing = {
  run: (encoder: GPUCommandEncoder) => void;
  dispatch: (pass: GPUComputePassEncoder) => void;
};

export const createSpectrogramWindowingCell = (
  device: GPUDevice,
  marker?: GPUComputePassTimestampWrites,
): ResourceCell<StateArg, SpectrogramWindowing> => {
  const pipeline = createPipeline(device);
  const stateCell = createStateCell(device, pipeline);

  return {
    get: (arg) => {
      const state = stateCell.get(arg);

      const dispatch = (pass: GPUComputePassEncoder) => {
        const { windowSize, windowCount } = state.params.value;
        const xCount = Math.ceil(windowSize / workgroupSize);
        pass.setPipeline(state.pipeline);
        pass.setBindGroup(0, state.bindGroup);
        pass.dispatchWorkgroups(xCount, windowCount);
      };

      return {
        run: (encoder) => {
          const pass = encoder.beginComputePass({
            label: 'windowing-pass',
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
