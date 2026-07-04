import { type ResourceCell } from '@musetric/utils';
import { type SpectrogramColumnRange } from '../common/extConfig.js';
import { createPipelines } from './pipeline.js';
import { createStateCell, type StateArg } from './state.js';

const workgroupSize = 64;

export type SpectrogramFundamentalFrequency = {
  lineBuffer: GPUBuffer;
  run: (encoder: GPUCommandEncoder) => void;

  dispatchObserve: (
    pass: GPUComputePassEncoder,
    range?: SpectrogramColumnRange,
  ) => void;

  dispatchTrack: (
    pass: GPUComputePassEncoder,
    range?: SpectrogramColumnRange,
  ) => void;
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

      const dispatchObserve = (
        pass: GPUComputePassEncoder,
        range?: SpectrogramColumnRange,
      ) => {
        const { columnCount, byteOffset } = state.params.writeRange(range);
        if (columnCount <= 0) {
          return;
        }

        pass.setPipeline(state.pipelines.observe);
        pass.setBindGroup(0, state.bindGroups.observe, [byteOffset]);
        pass.dispatchWorkgroups(columnCount);
      };

      const dispatchTrack = (
        pass: GPUComputePassEncoder,
        range?: SpectrogramColumnRange,
      ) => {
        const { columnCount, byteOffset } = state.params.writeRange(range);
        if (columnCount <= 0) {
          return;
        }
        const windowGroups = Math.max(
          1,
          Math.ceil(columnCount / workgroupSize),
        );

        pass.setPipeline(state.pipelines.track);
        pass.setBindGroup(0, state.bindGroups.track, [byteOffset]);
        pass.dispatchWorkgroups(windowGroups);
      };

      return {
        lineBuffer: state.output.line,
        run: (encoder) => {
          const pass = encoder.beginComputePass({
            label: 'fundamental-frequency-pass',
            timestampWrites: marker,
          });
          dispatchObserve(pass);
          dispatchTrack(pass);
          pass.end();
        },
        dispatchObserve,
        dispatchTrack,
      };
    },
    dispose: () => {
      stateCell.dispose();
    },
  };
};
