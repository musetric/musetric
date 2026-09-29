import { createIfftPackedStockhamC2r, type Fourier } from '@musetric/fft/gpu';
import { type PitchSettings } from './settings.es.js';
import { type PitchBuffers } from './state.js';

type PitchInverseCell = {
  get: (buffers: PitchBuffers, settings: PitchSettings) => Fourier;
  dispose: () => void;
};

export const createPitchInverseCell = (device: GPUDevice): PitchInverseCell => {
  const cell = createIfftPackedStockhamC2r(device);
  return {
    get: (buffers, settings) =>
      cell.get({
        wave: buffers.signal,
        spectrum: buffers.signal,
        config: {
          windowSize: settings.fftSize,
          windowCount: settings.batchSlots,
        },
      }),
    dispose: () => {
      cell.dispose();
    },
  };
};
