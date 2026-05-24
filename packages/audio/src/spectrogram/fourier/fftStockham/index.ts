import { type CreateFourier, type Fourier } from '../types.js';
import { createStateCell } from './state.js';

export const createFftStockham: CreateFourier = (device, markers) => {
  const stateCell = createStateCell(device);

  return {
    get: (arg) => {
      const state = stateCell.get(arg);

      const forward = (encoder: GPUCommandEncoder): void => {
        if (state.kind === 'shared') {
          // All log2(N) stages in one dispatch — no VRAM round-trips between stages.
          const pass = encoder.beginComputePass({
            label: 'stockham-shared-pass',
            timestampWrites: markers?.transform,
          });
          pass.setPipeline(state.pipeline);
          pass.setBindGroup(0, state.bindGroup);
          pass.dispatchWorkgroups(state.windowCount);
          pass.end();
          return;
        }

        // Global memory: one dispatch per stage, ping-pong between signal and pong buffers.
        // 2D dispatch: x = halfN/64 butterfly groups, y = windowCount.
        // Avoids exceeding maxComputeWorkgroupsPerDimension (65535).
        const halfN = state.windowSize >> 1;
        const xGroups = halfN / 64;
        const lastStage = state.log2N - 1;
        for (let s = 0; s < state.log2N; s++) {
          const pass = encoder.beginComputePass({
            label: `stockham-global-stage-${s}`,
            timestampWrites: s === lastStage ? markers?.transform : undefined,
          });
          pass.setPipeline(state.pipeline);
          pass.setBindGroup(0, state.bindGroups[s]);
          pass.dispatchWorkgroups(xGroups, state.windowCount);
          pass.end();
        }
        if (state.needsCopy) {
          const byteSize =
            state.windowSize *
            state.windowCount *
            Float32Array.BYTES_PER_ELEMENT;
          encoder.copyBufferToBuffer(
            state.pong.real,
            0,
            state.signal.real,
            0,
            byteSize,
          );
          encoder.copyBufferToBuffer(
            state.pong.imag,
            0,
            state.signal.imag,
            0,
            byteSize,
          );
        }
      };

      const forwardDispatch = (pass: GPUComputePassEncoder): void => {
        if (state.kind !== 'shared') {
          throw new Error(
            'fftStockham forwardDispatch is unavailable for windowSize exceeding shared-memory path',
          );
        }
        pass.setPipeline(state.pipeline);
        pass.setBindGroup(0, state.bindGroup);
        pass.dispatchWorkgroups(state.windowCount);
      };

      const ref: Fourier = {
        forward,
        forwardDispatch,
      };
      return ref;
    },
    dispose: () => {
      stateCell.dispose();
    },
  };
};
