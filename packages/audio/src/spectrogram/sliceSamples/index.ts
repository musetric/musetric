import { type ResourceCell } from '@musetric/resource-utils';
import { createPipeline } from './pipeline.js';
import { createStateCell, type StateArg } from './state.js';

const workgroupSize = 64;

export type SpectrogramSliceSamples = {
  run: (encoder: GPUCommandEncoder) => void;
  dispatch: (pass: GPUComputePassEncoder) => void;
  write: (
    samples: Float32Array,
    trackProgress: number,
    truncateAfterPlayhead: boolean,
  ) => void;
};

export const createSpectrogramSliceSamplesCell = (
  device: GPUDevice,
  marker?: GPUComputePassTimestampWrites,
): ResourceCell<StateArg, SpectrogramSliceSamples> => {
  const pipeline = createPipeline(device);
  const stateCell = createStateCell(device, pipeline);

  return {
    get: (arg) => {
      const state = stateCell.get(arg);

      const dispatch = (pass: GPUComputePassEncoder) => {
        const { paddedWindowSize, windowCount } = state.params.value;
        const xGroups = Math.ceil(paddedWindowSize / workgroupSize);
        pass.setPipeline(state.pipeline);
        pass.setBindGroup(0, state.bindGroup);
        pass.dispatchWorkgroups(xGroups, windowCount);
      };

      return {
        run: (encoder) => {
          const pass = encoder.beginComputePass({
            label: 'slice-samples-pass',
            timestampWrites: marker,
          });
          dispatch(pass);
          pass.end();
        },
        dispatch,
        write: (samples, trackProgress, truncateAfterPlayhead) => {
          state.samples.write(
            samples,
            trackProgress,
            state.config,
            truncateAfterPlayhead,
          );
        },
      };
    },
    dispose: () => {
      stateCell.dispose();
    },
  };
};
