import { type CreateFourier, type Fourier } from '../types.js';
import { createStateCell } from './state.js';

export const createFftPackedFusedTiledR2c: CreateFourier = (
  device,
  markers,
) => {
  const stateCell = createStateCell(device);

  return {
    get: (arg) => {
      const state = stateCell.get(arg);

      const dispatchTransform = (pass: GPUComputePassEncoder): void => {
        pass.setPipeline(state.pipelines.transform);
        pass.setBindGroup(0, state.bindGroups.transform);
        pass.dispatchWorkgroups(state.windowCount);
      };

      const ref: Fourier = {
        run: (encoder) => {
          const pass = encoder.beginComputePass({
            label:
              state.pipelines.kind === 'fused'
                ? 'packed-fused-tiled-r2c-fused'
                : 'packed-fused-tiled-r2c-fused-inplace',
            timestampWrites: markers?.transform,
          });
          dispatchTransform(pass);
          pass.end();
        },
        dispatch: dispatchTransform,
      };
      return ref;
    },
    dispose: () => {
      stateCell.dispose();
    },
  };
};
