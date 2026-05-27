import { describe, it } from 'vitest';
import { complexArrayFrom } from '../../common/complexArray.js';
import { createComplexGpuBufferReader } from '../../common/gpuBufferReader/index.js';
import { createGpuContext } from '../../common/gpuContext.js';
import { allFourierModes, type FourierMode } from '../../config.cross.js';
import { getPackedStockhamR2cVariant } from '../fftPackedStockhamR2c/support.js';
import { getPackedTiledR2cVariant } from '../fftPackedTiledR2c/support.js';
import { getPrunedFourStepR2cVariant } from '../fftPrunedFourStepR2c/support.js';
import { fouriers } from '../fouriers.js';
import { assertArrayClose, createBuffers, windowCount } from './common.js';
import { fourierFixtures } from './fixture.js';

const isFourierFixtureSupported = (
  device: GPUDevice,
  mode: FourierMode,
  windowSize: number,
): boolean => {
  const config = { windowSize, windowCount };

  if (mode === 'fftPrunedFourStepR2c') {
    return getPrunedFourStepR2cVariant(device, config) !== undefined;
  }

  if (mode === 'fftPackedStockhamR2c') {
    return getPackedStockhamR2cVariant(device, config) !== undefined;
  }

  return getPackedTiledR2cVariant(device, config) !== undefined;
};

describe('fourier', async () => {
  const { device } = await createGpuContext();

  for (const mode of allFourierModes) {
    describe(mode, () => {
      for (const fixture of fourierFixtures) {
        describe(fixture.name, () => {
          if (!isFourierFixtureSupported(device, mode, fixture.windowSize)) {
            it.skip('forward', () => undefined);
            return;
          }

          it('forward', async () => {
            const buffers = createBuffers(device, fixture.windowSize);
            const createFourierCell = fouriers[mode];
            const fourierCell = createFourierCell(device);
            const reader = createComplexGpuBufferReader({
              device,
              typeSize: Float32Array.BYTES_PER_ELEMENT,
              size: fixture.windowSize,
            });

            try {
              const fourier = fourierCell.get({
                signal: buffers.signal,
                config: {
                  windowSize: fixture.windowSize,
                  windowCount,
                },
              });
              const zeroImag = new Float32Array(fixture.windowSize).fill(0);
              device.queue.writeBuffer(buffers.signal.real, 0, fixture.input);
              device.queue.writeBuffer(buffers.signal.imag, 0, zeroImag);
              const encoder = device.createCommandEncoder();
              fourier.forward(encoder);
              const command = encoder.finish();
              device.queue.submit([command]);
              await device.queue.onSubmittedWorkDone();
              const outputBuffer = await reader.read(buffers.signal);
              const result = complexArrayFrom(outputBuffer);
              const positiveSize = fixture.windowSize / 2 + 1;
              assertArrayClose(
                'real',
                result.real.slice(0, positiveSize),
                fixture.output.real,
              );
              assertArrayClose(
                'imag',
                result.imag.slice(0, positiveSize),
                fixture.output.imag,
              );
            } finally {
              fourierCell.dispose();
              reader.destroy();
              buffers.destroy();
            }
          });
        });
      }
    });
  }
});
