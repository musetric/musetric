import { type CreateFourier, type Fourier } from '../types.js';
import { createStateCell } from './state.js';

export const createIfftPackedStockhamC2r: CreateFourier = (device, markers) => {
  const stateCell = createStateCell(device);
  return {
    get: (arg): Fourier => {
      const state = stateCell.get(arg);

      const dispatch = (pass: GPUComputePassEncoder): void => {
        const { variant, pipeline, bindGroups } = state;
        if (
          variant.kind === 'multiPass' &&
          pipeline.kind === 'multiPass' &&
          bindGroups.kind === 'multiPass'
        ) {
          pipeline.stages.forEach((stagePipeline, index) => {
            pass.setPipeline(stagePipeline);
            pass.setBindGroup(0, bindGroups.stages[index]);
            pass.dispatchWorkgroups(
              state.windowCount,
              variant.stages[index].workgroupCount,
            );
          });
          return;
        }

        if (
          pipeline.kind === 'singlePass' &&
          bindGroups.kind === 'singlePass'
        ) {
          pass.setPipeline(pipeline.transform);
          pass.setBindGroup(0, bindGroups.transform);
          pass.dispatchWorkgroups(state.windowCount);
        }
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
