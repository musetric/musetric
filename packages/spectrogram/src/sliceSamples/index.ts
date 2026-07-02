import { type ResourceCell } from '@musetric/utils';
import {
  type SpectrogramColumnRange,
  type SpectrogramSampleRange,
} from '../common/extConfig.js';
import { createPipeline } from './pipeline.js';
import { createStateCell, type StateArg } from './state.js';

const workgroupSize = 64;

export type SpectrogramSliceSamples = {
  run: (encoder: GPUCommandEncoder, range: SpectrogramColumnRange) => void;
  dispatch: (
    pass: GPUComputePassEncoder,
    range: SpectrogramColumnRange,
  ) => void;
  write: (options: {
    samples: Float32Array;
    baseColumn: number;
    truncateAfterPlayhead: boolean;
    forceFullUpload: boolean;
    invalidations: readonly SpectrogramSampleRange[];
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
        const xGroups = Math.ceil(paddedWindowSize / workgroupSize);
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
          const {
            samples,
            baseColumn,
            truncateAfterPlayhead,
            forceFullUpload,
            invalidations,
          } = options;
          const writeResult = state.samples.write({
            samples,
            baseColumn,
            config: state.config,
            truncateAfterPlayhead,
            forceFullUpload,
            invalidations,
          });
          state.params.setFrame({
            baseColumn,
            baseWindowStart: writeResult.baseWindowStart,
            ringStart: writeResult.ringStart,
          });
        },
      };
    },
    dispose: () => {
      stateCell.dispose();
    },
  };
};
