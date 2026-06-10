import { type CreateFourier, type Fourier } from '../types.js';
import { createStateCell } from './state.js';

export const createFftPackedStockhamR2c: CreateFourier = (device, markers) => {
  const stateCell = createStateCell(device);

  return {
    get: (arg) => {
      const state = stateCell.get(arg);

      const dispatch = (pass: GPUComputePassEncoder): void => {
        if (state.kind === 'multiPass') {
          state.pipeline.stages.forEach((pipeline, index) => {
            const stage = state.variant.stages[index];
            const bindGroup = state.bindGroups.stages[index];
            pass.setPipeline(pipeline);
            pass.setBindGroup(0, bindGroup);
            pass.dispatchWorkgroups(state.windowCount, stage.workgroupCount);
          });
          return;
        }

        pass.setPipeline(state.pipeline.transform);
        pass.setBindGroup(0, state.bindGroups.transform);
        pass.dispatchWorkgroups(state.windowCount);
      };

      const ref: Fourier = {
        run: (encoder) => {
          const pass = encoder.beginComputePass({
            label: 'packed-stockham-r2c-transform',
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
