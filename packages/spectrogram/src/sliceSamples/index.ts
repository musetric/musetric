import { type ResourceCell } from '@musetric/utils';
import { type SpectrogramColumnRange } from '../common/extConfig.js';
import { type SpectrogramSource } from '../common/source.js';
import { createPipeline } from './pipeline.js';
import { type StateSamplesFrame, writeColumnOffsets } from './samples.js';
import { sliceSamplesPerThread } from './sliceSamples.wgsl.js';
import { createStateCell, type StateArg } from './state.js';

const workgroupSize = 64;

export type SpectrogramSliceSamples = {
  run: (encoder: GPUCommandEncoder, range: SpectrogramColumnRange) => void;
  dispatch: (
    pass: GPUComputePassEncoder,
    range: SpectrogramColumnRange,
  ) => void;
  write: (options: {
    source: SpectrogramSource;
    baseColumn: number;
    frame: StateSamplesFrame;
  }) => void;
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

      const dispatch = (
        pass: GPUComputePassEncoder,
        range: SpectrogramColumnRange,
      ) => {
        if (range.columnCount <= 0) {
          return;
        }
        const { paddedWindowSize } = state.params.value;
        const byteOffset = state.params.writeRange(range);
        const xGroups = Math.ceil(
          paddedWindowSize / (workgroupSize * sliceSamplesPerThread),
        );
        pass.setPipeline(state.pipeline);
        pass.setBindGroup(0, state.bindGroup, [byteOffset]);
        pass.dispatchWorkgroups(xGroups, range.columnCount);
      };

      return {
        run: (encoder, range) => {
          const pass = encoder.beginComputePass({
            label: 'slice-samples-pass',
            timestampWrites: marker,
          });
          dispatch(pass, range);
          pass.end();
        },
        dispatch,
        write: (options) => {
          const { source, baseColumn, frame } = options;
          if (source.mapped) {
            writeColumnOffsets(device, state.columnOffsets, {
              source,
              config: state.config,
              baseColumn,
              frame,
            });
          }
          state.params.setFrame({
            baseColumn,
            baseWindowStart: frame.baseWindowStart,
            ringStart: frame.ringStart,
            ringLength: frame.ringLength,
            mapped: source.mapped,
          });
        },
      };
    },
    dispose: () => {
      stateCell.dispose();
    },
  };
};
