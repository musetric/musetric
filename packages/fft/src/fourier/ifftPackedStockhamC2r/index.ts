import { resolveFourierBatchRange } from '../batchRange.js';
import {
  type CreateFourier,
  type Fourier,
  type FourierBatchRange,
} from '../types.js';
import { createStateCell } from './state.js';

export const createIfftPackedStockhamC2r: CreateFourier = (device, markers) => {
  const stateCell = createStateCell(device);
  return {
    get: (arg): Fourier => {
      const state = stateCell.get(arg);

      const dispatch = (
        pass: GPUComputePassEncoder,
        range?: FourierBatchRange,
      ): void => {
        const { batchOffset, batchCount } = resolveFourierBatchRange(
          range,
          state.windowCount,
        );
        if (batchCount === 0) {
          return;
        }
        const slot = state.params.reserve(batchOffset);

        if (state.kind === 'multiPass') {
          const stages = state.getStageBindGroups(slot);
          state.pipeline.stages.forEach((stagePipeline, index) => {
            const kernel = state.variant.kernels[index];
            pass.setPipeline(stagePipeline);
            pass.setBindGroup(0, stages[index]);
            pass.dispatchWorkgroups(batchCount, kernel.workgroupCount);
          });
          return;
        }

        pass.setPipeline(state.pipeline.transform);
        pass.setBindGroup(0, state.getBindGroup(slot));
        pass.dispatchWorkgroups(batchCount);
      };

      const ref: Fourier = {
        run: (encoder) => {
          const pass = encoder.beginComputePass({
            label: 'packed-stockham-c2r-transform',
            timestampWrites: markers?.transform,
          });
          dispatch(pass);
          pass.end();
        },
        dispatch,
      };
      return ref;
    },
    dispose: () => {
      stateCell.dispose();
    },
  };
};
