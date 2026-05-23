import { type CreateFourier, type Fourier } from '../types.js';
import { createReversePipeline, createTransformPipeline } from './pipeline.js';
import { createStateCell } from './state.js';

export const createFftRadix2: CreateFourier = (device, markers) => {
  const pipelines = {
    reverse: createReversePipeline(device),
    transform: createTransformPipeline(device),
  };
  const stateCell = createStateCell(device, pipelines);

  return {
    get: (arg) => {
      const state = stateCell.get(arg);

      const dispatchReverse = (pass: GPUComputePassEncoder) => {
        const { windowCount } = state.params.value;
        pass.setPipeline(state.pipelines.reverse);
        pass.setBindGroup(0, state.bindGroups.reverse);
        pass.dispatchWorkgroups(windowCount);
      };

      const dispatchTransform = (pass: GPUComputePassEncoder) => {
        const { windowCount } = state.params.value;
        pass.setPipeline(state.pipelines.transform);
        pass.setBindGroup(0, state.bindGroups.transform);
        pass.dispatchWorkgroups(windowCount);
      };

      const reverse = (encoder: GPUCommandEncoder) => {
        const pass = encoder.beginComputePass({
          label: 'fft2-reverse-pass',
          timestampWrites: markers?.reverse,
        });
        dispatchReverse(pass);
        pass.end();
      };

      const transform = (encoder: GPUCommandEncoder) => {
        const pass = encoder.beginComputePass({
          label: 'fft2-transform-pass',
          timestampWrites: markers?.transform,
        });
        dispatchTransform(pass);
        pass.end();
      };

      const ref: Fourier = {
        forward: (encoder) => {
          reverse(encoder);
          transform(encoder);
        },
        forwardDispatch: (pass) => {
          dispatchReverse(pass);
          dispatchTransform(pass);
        },
      };

      return ref;
    },
    dispose: () => {
      stateCell.dispose();
    },
  };
};
