import {
  complexArrayFrom,
  createComplexGpuBufferReader,
  createGpuBufferReader,
  createGpuContext,
} from '@musetric/resource-utils/gpu';
import { describe, it } from 'vitest';
import {
  allFourierModes,
  allIFourierModes,
  type FourierMode,
  type IFourierMode,
} from '../config.es.js';
import { fouriers } from '../fouriers.js';
import { getPackedStockhamC2rVariant } from '../ifftPackedStockhamC2r/support.js';
import { iffts } from '../iffts.js';
import {
  assertArrayClose,
  createBuffers,
  createIFourierBuffers,
  windowCount,
} from './common.js';
import { fourierFixtures } from './fixture.js';
import { formatRadixStages } from './formatRadixStages.es.js';
import { isFourierModeSupported } from './fourierModeSupport.js';

const isFourierFixtureSupported = (
  device: GPUDevice,
  mode: FourierMode,
  windowSize: number,
): boolean => {
  return isFourierModeSupported(device, mode, {
    windowSize,
    windowCount,
  });
};

const ifourierFixtureSupports: Record<
  IFourierMode,
  (device: GPUDevice, windowSize: number) => boolean
> = {
  ifftPackedStockhamC2r: (device, windowSize) => {
    const config = { windowSize, windowCount };
    return getPackedStockhamC2rVariant(device, config) !== undefined;
  },
};

const isIFourierFixtureSupported = (
  device: GPUDevice,
  mode: IFourierMode,
  windowSize: number,
): boolean => ifourierFixtureSupports[mode](device, windowSize);

const { device } = await createGpuContext();

const fixtures = Object.groupBy(
  fourierFixtures,
  (fixture) => fixture.windowSize,
);

Object.entries(fixtures).forEach((entry) => {
  const [rawWindowSize, group] = entry;
  const windowSize = Number(rawWindowSize);

  if (!group) return;

  const factorization = formatRadixStages(windowSize) ?? String(windowSize);

  describe(`Fourier ${factorization}-point`, () => {
    for (const fixture of group) {
      describe(fixture.caseName, () => {
        allFourierModes.forEach((mode) => {
          if (!isFourierFixtureSupported(device, mode, windowSize)) {
            return;
          }

          it(mode, async () => {
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
                wave: buffers.signal.real,
                spectrum: buffers.signal,
                config: {
                  windowSize: fixture.windowSize,
                  windowCount,
                },
              });
              const zeroImag = new Float32Array(fixture.windowSize).fill(0);
              device.queue.writeBuffer(buffers.signal.real, 0, fixture.wave);
              device.queue.writeBuffer(buffers.signal.imag, 0, zeroImag);
              const encoder = device.createCommandEncoder();
              fourier.run(encoder);
              const command = encoder.finish();
              device.queue.submit([command]);
              await device.queue.onSubmittedWorkDone();
              const outputBuffer = await reader.read(buffers.signal);
              const result = complexArrayFrom(outputBuffer);
              const positiveSize = fixture.windowSize / 2 + 1;
              assertArrayClose(
                'real',
                result.real.slice(0, positiveSize),
                fixture.spectrum.real,
              );
              assertArrayClose(
                'imag',
                result.imag.slice(0, positiveSize),
                fixture.spectrum.imag,
              );
            } finally {
              fourierCell.dispose();
              reader.destroy();
              buffers.destroy();
            }
          });
        });

        allIFourierModes.forEach((mode) => {
          if (!isIFourierFixtureSupported(device, mode, fixture.windowSize)) {
            return;
          }

          it(mode, async () => {
            const buffers = createIFourierBuffers(device, {
              spectrumSize: fixture.spectrum.real.byteLength,
              waveSize: fixture.wave.byteLength,
            });
            const reader = createGpuBufferReader({
              device,
              typeSize: Float32Array.BYTES_PER_ELEMENT,
              size: fixture.windowSize,
            });
            const createIFourierCell = iffts[mode];
            const ifftCell = createIFourierCell(device);

            try {
              device.queue.writeBuffer(
                buffers.spectrum.real,
                0,
                fixture.spectrum.real,
              );
              device.queue.writeBuffer(
                buffers.spectrum.imag,
                0,
                fixture.spectrum.imag,
              );

              const ifft = ifftCell.get({
                wave: buffers.wave,
                spectrum: buffers.spectrum,
                config: {
                  windowSize: fixture.windowSize,
                  windowCount,
                },
              });
              const encoder = device.createCommandEncoder();
              ifft.run(encoder);
              const command = encoder.finish();
              device.queue.submit([command]);
              await device.queue.onSubmittedWorkDone();

              const result = new Float32Array(await reader.read(buffers.wave));
              assertArrayClose('wave', result, fixture.wave);
            } finally {
              ifftCell.dispose();
              reader.destroy();
              buffers.destroy();
            }
          });
        });
      });
    }
  });
});
