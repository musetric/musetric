import { type ResourceCell } from '@musetric/utils';
import { type SpectrogramColumnRange } from '../common/extConfig.js';
import { createPipelines } from './pipeline.js';
import { createStateCell, type StateArg } from './state.js';

const workgroupSize = 64;

export type SpectrogramFundamentalFrequency = {
  buffer: GPUBuffer;
  run: (encoder: GPUCommandEncoder) => void;

  dispatchScore: (
    pass: GPUComputePassEncoder,
    range?: SpectrogramColumnRange,
  ) => void;

  dispatchFilter: (
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

      const dispatchScore = (
        pass: GPUComputePassEncoder,
        range?: SpectrogramColumnRange,
      ) => {
        const { columnCount, byteOffset } = state.params.writeRange(range);
        if (columnCount <= 0) {
          return;
        }

        pass.setPipeline(state.pipelines.scoreAndPick);
        pass.setBindGroup(0, state.bindGroups.scoreAndPick, [byteOffset]);
        pass.dispatchWorkgroups(columnCount);
      };

      const dispatchFilter = (
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

        pass.setPipeline(state.pipelines.filter);
        pass.setBindGroup(0, state.bindGroups.filter, [byteOffset]);
        pass.dispatchWorkgroups(windowGroups);
      };

      return {
        buffer: state.output.filtered,
        run: (encoder) => {
          const pass = encoder.beginComputePass({
            label: 'fundamental-frequency-pass',
            timestampWrites: marker,
          });
          dispatchScore(pass);
          dispatchFilter(pass);
          pass.end();
        },
        dispatchScore,
        dispatchFilter,
      };
    },
    dispose: () => {
      stateCell.dispose();
    },
  };
};
