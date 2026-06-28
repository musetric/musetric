import { type ResourceCell } from '@musetric/utils';
import { type SpectrogramColumnRange } from '../common/extConfig.js';
import { createPipelines } from './pipeline.js';
import { createStateCell, type StateArg } from './state.js';

const workgroupSize = 64;

export type SpectrogramDecibelify = {
  columnEnergy: GPUBuffer;
  run: (encoder: GPUCommandEncoder) => void;
  dispatchEnergy: (
    pass: GPUComputePassEncoder,
    range?: Pick<SpectrogramColumnRange, 'slotOffset' | 'columnCount'>,
  ) => void;
  dispatchRun: (
    pass: GPUComputePassEncoder,
    range?: Pick<SpectrogramColumnRange, 'slotOffset' | 'columnCount'>,
  ) => void;
  dispatch: (
    pass: GPUComputePassEncoder,
    range?: Pick<SpectrogramColumnRange, 'slotOffset' | 'columnCount'>,
  ) => void;
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

      const dispatchEnergy = (
        pass: GPUComputePassEncoder,
        range?: Pick<SpectrogramColumnRange, 'slotOffset' | 'columnCount'>,
      ) => {
        const { columnCount, byteOffset } = state.params.writeRange(range);
        if (columnCount <= 0) {
          return;
        }

        pass.setPipeline(state.pipelines.energy);
        pass.setBindGroup(0, state.bindGroup, [byteOffset]);
        pass.dispatchWorkgroups(columnCount);
      };

      const dispatchRun = (
        pass: GPUComputePassEncoder,
        range?: Pick<SpectrogramColumnRange, 'slotOffset' | 'columnCount'>,
      ) => {
        const { halfSize } = state.params.value;
        const xCount = Math.ceil(halfSize / workgroupSize);
        const { columnCount, byteOffset } = state.params.writeRange(range);
        if (columnCount <= 0) {
          return;
        }

        pass.setPipeline(state.pipelines.run);
        pass.setBindGroup(0, state.bindGroup, [byteOffset]);
        pass.dispatchWorkgroups(xCount, columnCount);
      };

      const dispatch = (
        pass: GPUComputePassEncoder,
        range?: Pick<SpectrogramColumnRange, 'slotOffset' | 'columnCount'>,
      ) => {
        dispatchEnergy(pass, range);
        dispatchRun(pass, range);
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
