import { afterAll, describe, it } from 'vitest';
import { complexArrayFrom } from '../../common/complexArray.js';
import { createComplexGpuBufferReader } from '../../common/gpuBufferReader/index.js';
import { createGpuContext } from '../../common/gpuContext.js';
import { allFourierModes } from '../../config.cross.js';
import { fouriers } from '../fouriers.js';
import { assertArrayClose, createBuffers, windowCount } from './common.js';
import { fourierFixtures } from './fixture.js';

describe('fourier', async () => {
  const { device } = await createGpuContext();

  for (const mode of allFourierModes) {
    describe(mode, () => {
      for (const fixture of fourierFixtures) {
        describe(fixture.name, () => {
          const buffers = createBuffers(device, fixture.windowSize);
          const createFourierCell = fouriers[mode];
          const fourierCell = createFourierCell(device);
          const fourier = fourierCell.get({
            signal: buffers.signal,
            config: {
              windowSize: fixture.windowSize,
              windowCount,
            },
          });
          const reader = createComplexGpuBufferReader({
            device,
            typeSize: Float32Array.BYTES_PER_ELEMENT,
            size: fixture.windowSize,
          });

          it('forward', async () => {
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
          });

          afterAll(() => {
            fourierCell.dispose();
            reader.destroy();
            buffers.destroy();
          });
        });
      }
    });
  }
});
