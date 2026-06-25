import { type ResourceCell } from '@musetric/utils';
import { createPipelines } from './pipeline.js';
import { createStateCell, type StateArg } from './state.js';

const workgroupSize = 64;

export type SpectrogramFundamentalFrequency = {
  buffer: GPUBuffer;
  run: (encoder: GPUCommandEncoder) => void;
  dispatch: (pass: GPUComputePassEncoder) => void;
};

export const createSpectrogramFundamentalFrequencyCell = (
  device: GPUDevice,
  marker?: GPUComputePassTimestampWrites,
): ResourceCell<StateArg, SpectrogramFundamentalFrequency> => {
  const pipelines = createPipelines(device);
  const stateCell = createStateCell(device, pipelines);

  return {
    get: (arg) => {
      const state = stateCell.get(arg);

      const dispatch = (pass: GPUComputePassEncoder) => {
        const { windowCount, candidateCount } = state.params.value;
        const scoreThreads = Math.max(1, windowCount * candidateCount);
        const scoreGroups = Math.ceil(scoreThreads / workgroupSize);
        const windowGroups = Math.max(
          1,
          Math.ceil(windowCount / workgroupSize),
        );

        pass.setPipeline(state.pipelines.scoreCandidates);
        pass.setBindGroup(0, state.bindGroups.scoreCandidates);
        pass.dispatchWorkgroups(scoreGroups);

        pass.setPipeline(state.pipelines.pickBest);
        pass.setBindGroup(0, state.bindGroups.pickBest);
        pass.dispatchWorkgroups(windowGroups);

        pass.setPipeline(state.pipelines.filter);
        pass.setBindGroup(0, state.bindGroups.filter);
        pass.dispatchWorkgroups(windowGroups);
      };

      return {
        buffer: state.output.filtered,
        run: (encoder) => {
          const pass = encoder.beginComputePass({
            label: 'fundamental-frequency-pass',
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
