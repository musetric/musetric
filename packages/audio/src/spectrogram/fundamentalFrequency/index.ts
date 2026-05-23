import type { ResourceCell } from '@musetric/resource-utils';
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
        const xGroups = Math.max(
          1,
          Math.ceil(state.params.value.windowCount / workgroupSize),
        );
        pass.setPipeline(state.pipelines.detect);
        pass.setBindGroup(0, state.bindGroups.detect);
        pass.dispatchWorkgroups(xGroups);
        pass.setPipeline(state.pipelines.filter);
        pass.setBindGroup(0, state.bindGroups.filter);
        pass.dispatchWorkgroups(xGroups);
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
