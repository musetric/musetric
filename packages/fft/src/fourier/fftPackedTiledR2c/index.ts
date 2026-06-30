import { resolveFourierBatchRange } from '../batchRange.js';
import {
  type CreateFourier,
  type Fourier,
  type FourierBatchRange,
} from '../types.js';
import { createStateCell } from './state.js';

export const createFftPackedTiledR2c: CreateFourier = (device, markers) => {
  const stateCell = createStateCell(device);

  return {
    get: (arg) => {
      const state = stateCell.get(arg);

      const dispatchFirstPass = (
        pass: GPUComputePassEncoder,
        bindGroups: ReturnType<typeof state.getBindGroups>,
        batchCount: number,
      ): void => {
        pass.setPipeline(state.pipelines.firstPass);
        pass.setBindGroup(0, bindGroups.firstPass);
        pass.dispatchWorkgroups(state.firstPassXGroups, batchCount);
      };

      const dispatchSecondPass = (
        pass: GPUComputePassEncoder,
        bindGroups: ReturnType<typeof state.getBindGroups>,
        batchCount: number,
      ): void => {
        pass.setPipeline(state.pipelines.secondPass);
        pass.setBindGroup(0, bindGroups.secondPass);
        pass.dispatchWorkgroups(state.secondPassXGroups, batchCount);
      };

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
        const bindGroups = state.getBindGroups(slot);
        dispatchFirstPass(pass, bindGroups, batchCount);
        dispatchSecondPass(pass, bindGroups, batchCount);
      };

      const ref: Fourier = {
        run: (encoder) => {
          const firstPass = encoder.beginComputePass({
            label: 'packed-tiled-r2c-first-pass',
            timestampWrites: markers?.reverse,
          });
          const slot = state.params.reserve(0);
          const bindGroups = state.getBindGroups(slot);
          dispatchFirstPass(firstPass, bindGroups, state.windowCount);
          firstPass.end();

          const secondPass = encoder.beginComputePass({
            label: 'packed-tiled-r2c-second-pass',
            timestampWrites: markers?.transform,
          });
          dispatchSecondPass(secondPass, bindGroups, state.windowCount);
          secondPass.end();
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
