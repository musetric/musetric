import { type ResourceCell } from '@musetric/utils';
import { ringStartByteOffset } from './params.js';
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
    contentChanged: boolean,
  ) => void;
};

export const createSpectrogramSliceSamplesCell = (
  device: GPUDevice,
  marker?: GPUComputePassTimestampWrites,
): ResourceCell<StateArg, SpectrogramSliceSamples> => {
  const pipeline = createPipeline(device);
  const stateCell = createStateCell(device, pipeline);
  const ringStartScratch = new Uint32Array(1);

  return {
    get: (arg) => {
      const state = stateCell.get(arg);

      const dispatch = (pass: GPUComputePassEncoder) => {
        const { windowSize, windowCount } = state.params.value;
        const xGroups = Math.ceil(windowSize / workgroupSize);
        pass.setPipeline(state.pipeline);
        pass.setBindGroup(0, state.bindGroup);
        pass.dispatchWorkgroups(xGroups, windowCount);
      };

      return {
        run: (encoder) => {
          const { paddedWindowSize, windowSize } = state.params.value;
          if (paddedWindowSize > windowSize) {
            encoder.clearBuffer(state.out);
          }
          const pass = encoder.beginComputePass({
            label: 'slice-samples-pass',
            timestampWrites: marker,
          });
          dispatch(pass);
          pass.end();
        },
        dispatch,
        write: (
          samples,
          trackProgress,
          truncateAfterPlayhead,
          contentChanged,
        ) => {
          const ringStart = state.samples.write(
            samples,
            trackProgress,
            state.config,
            truncateAfterPlayhead,
            state.sampleOffset,
            contentChanged,
          );
          ringStartScratch[0] = ringStart;
          device.queue.writeBuffer(
            state.params.buffer,
            ringStartByteOffset,
            ringStartScratch,
          );
        },
      };
    },
    dispose: () => {
      stateCell.dispose();
    },
  };
};
