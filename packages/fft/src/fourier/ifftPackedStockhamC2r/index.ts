import { type CreateFourier, type Fourier } from '../types.js';
import { createStateCell } from './state.js';

export const createIfftPackedStockhamC2r: CreateFourier = (device, markers) => {
  const stateCell = createStateCell(device);
  return {
    get: (arg): Fourier => {
      const state = stateCell.get(arg);

      const dispatch = (pass: GPUComputePassEncoder): void => {
        pass.setPipeline(state.pipeline);
        pass.setBindGroup(0, state.bindGroup);
        pass.dispatchWorkgroups(state.windowCount);
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
