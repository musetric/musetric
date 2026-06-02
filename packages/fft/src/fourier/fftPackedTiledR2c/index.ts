import { type CreateFourier, type Fourier } from '../types.js';
import { createStateCell } from './state.js';

export const createFftPackedTiledR2c: CreateFourier = (device, markers) => {
  const stateCell = createStateCell(device);

  return {
    get: (arg) => {
      const state = stateCell.get(arg);

      const dispatchFirstPass = (pass: GPUComputePassEncoder): void => {
        pass.setPipeline(state.pipelines.firstPass);
        pass.setBindGroup(0, state.bindGroups.firstPass);
        pass.dispatchWorkgroups(state.firstPassXGroups, state.windowCount);
      };

      const dispatchSecondPass = (pass: GPUComputePassEncoder): void => {
        pass.setPipeline(state.pipelines.secondPass);
        pass.setBindGroup(0, state.bindGroups.secondPass);
        pass.dispatchWorkgroups(state.secondPassXGroups, state.windowCount);
      };

      const ref: Fourier = {
        forward: (encoder) => {
          const firstPass = encoder.beginComputePass({
            label: 'packed-tiled-r2c-first-pass',
            timestampWrites: markers?.reverse,
          });
          dispatchFirstPass(firstPass);
          firstPass.end();

          const secondPass = encoder.beginComputePass({
            label: 'packed-tiled-r2c-second-pass',
            timestampWrites: markers?.transform,
          });
          dispatchSecondPass(secondPass);
          secondPass.end();
        },
        forwardDispatch: (pass) => {
          dispatchFirstPass(pass);
          dispatchSecondPass(pass);
        },
      };
      return ref;
    },
    dispose: () => {
      stateCell.dispose();
    },
  };
};
