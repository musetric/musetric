import { type ResourceCell } from '@musetric/resource-utils';
import { createPipeline } from './pipeline.js';
import { createStateCell, type StateArg } from './state.js';

const workgroupSize = 16;

export type SpectrogramRemap = {
  run: (encoder: GPUCommandEncoder) => void;
};

export const createSpectrogramRemapCell = (
  device: GPUDevice,
  marker?: GPUComputePassTimestampWrites,
): ResourceCell<StateArg, SpectrogramRemap> => {
  const pipeline = createPipeline(device);
  const stateCell = createStateCell(device, pipeline);

  return {
    get: (arg) => {
      const state = stateCell.get(arg);

      return {
        run: (encoder) => {
          const { width, height } = state.params.value;
          const xGroups = Math.ceil(width / workgroupSize);
          const yGroups = Math.ceil(height / workgroupSize);

          const pass = encoder.beginComputePass({
            label: 'remap-column-pass',
            timestampWrites: marker,
          });
          pass.setPipeline(state.pipeline);
          pass.setBindGroup(0, state.bindGroup);
          pass.dispatchWorkgroups(xGroups, yGroups);
          pass.end();
        },
      };
    },
    dispose: () => {
      stateCell.dispose();
    },
  };
};
