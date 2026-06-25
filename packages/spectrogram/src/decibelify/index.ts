import { type ResourceCell } from '@musetric/utils';
import { createPipelines } from './pipeline.js';
import { createStateCell, type StateArg } from './state.js';

const workgroupSize = 64;

export type SpectrogramDecibelify = {
  columnEnergy: GPUBuffer;
  run: (encoder: GPUCommandEncoder) => void;
  dispatchEnergy: (pass: GPUComputePassEncoder) => void;
  dispatchRun: (pass: GPUComputePassEncoder) => void;
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

      const dispatchEnergy = (pass: GPUComputePassEncoder) => {
        const { windowCount } = state.params.value;

        pass.setPipeline(state.pipelines.energy);
        pass.setBindGroup(0, state.bindGroup);
        pass.dispatchWorkgroups(windowCount);
      };

      const dispatchRun = (pass: GPUComputePassEncoder) => {
        const { halfSize, windowCount } = state.params.value;
        const xCount = Math.ceil(halfSize / workgroupSize);

        pass.setPipeline(state.pipelines.run);
        pass.setBindGroup(0, state.bindGroup);
        pass.dispatchWorkgroups(xCount, windowCount);
      };

      const dispatch = (pass: GPUComputePassEncoder) => {
        dispatchEnergy(pass);
        dispatchRun(pass);
      };

      return {
        columnEnergy: state.columnEnergy,
        run: (encoder) => {
          const pass = encoder.beginComputePass({
            label: 'decibelify-pass',
            timestampWrites: marker,
          });
          dispatch(pass);
          pass.end();
        },
        dispatchEnergy,
        dispatchRun,
        dispatch,
      };
    },
    dispose: () => {
      stateCell.dispose();
    },
  };
};
