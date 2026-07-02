import { type ResourceCell } from '@musetric/utils';
import { type SpectrogramColumnRange } from '../common/extConfig.js';
import { createPipelines } from './pipeline.js';
import { createStateCell, type StateArg } from './state.js';

const workgroupSize = 64;

export type SpectrogramMagnitudify = {
  magnitude: GPUBuffer;
  run: (encoder: GPUCommandEncoder) => void;
  dispatch: (
    pass: GPUComputePassEncoder,
    range?: Pick<SpectrogramColumnRange, 'slotOffset' | 'columnCount'>,
  ) => void;
};

export const createSpectrogramMagnitudifyCell = (
  device: GPUDevice,
  marker?: GPUComputePassTimestampWrites,
): ResourceCell<StateArg, SpectrogramMagnitudify> => {
  const pipelines = createPipelines(device);
  const stateCell = createStateCell(device, pipelines);

  return {
    get: (arg) => {
      const state = stateCell.get(arg);

      const dispatch = (
        pass: GPUComputePassEncoder,
        range?: Pick<SpectrogramColumnRange, 'slotOffset' | 'columnCount'>,
      ) => {
        const { windowSize } = state.params.value;
        const halfSize = Math.ceil(windowSize / 2);
        const xCount = Math.ceil(halfSize / workgroupSize);
        const { columnCount, byteOffset } = state.params.writeRange(range);
        if (columnCount <= 0) {
          return;
        }

        pass.setPipeline(state.pipelines.run);
        pass.setBindGroup(0, state.bindGroup, [byteOffset]);
        pass.dispatchWorkgroups(xCount, columnCount);
      };

      return {
        magnitude: state.magnitude,
        run: (encoder) => {
          const pass = encoder.beginComputePass({
            label: 'magnitudify-pass',
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
