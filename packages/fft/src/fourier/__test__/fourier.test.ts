import {
  complexArrayFrom,
  createGpuBufferReader,
  createGpuContext,
  createInterleavedGpuBufferReader,
} from '@musetric/utils/gpu';
import { describe, expect, it } from 'vitest';
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
  createInterleavedSpectrum,
  createPaddedWave,
  windowCount,
} from './common.js';
import { type FourierFixture, fourierFixtures } from './fixture.js';
import { formatRadixStages } from './formatRadixStages.es.js';
import { isFourierModeSupported } from './fourierModeSupport.js';

const isFourierFixtureSupported = (
  device: GPUDevice,
  mode: FourierMode,
  windowSize: number,
): boolean =>
  isFourierModeSupported(device, mode, {
    windowSize,
    windowCount,
  });

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
const transformKinds = ['in-place', 'out-of-place'] as const;

const fixtures = Object.groupBy(
  fourierFixtures,
  (fixture) => fixture.windowSize,
);

const runFourierTests = (fixture: FourierFixture) => {
  allFourierModes.forEach((mode) => {
    if (!isFourierFixtureSupported(device, mode, fixture.windowSize)) {
      return;
    }

    transformKinds.forEach((transformKind) => {
      it(`${mode} ${transformKind}`, async () => {
        const buffers = createBuffers(device, fixture.windowSize);
        const createFourierCell = fouriers[mode];
        const fourierCell = createFourierCell(device);
        const reader = createInterleavedGpuBufferReader({
          device,
          windowSize: fixture.windowSize,
          windowCount,
        });

        try {
          const inPlace = transformKind === 'in-place';
          const wave = inPlace ? buffers.inPlace : buffers.wave;
          const spectrum = inPlace ? buffers.inPlace : buffers.spectrum;
          if (inPlace) {
            expect(buffers.inPlaceByteSize).toBe(
              (fixture.windowSize + 2) * Float32Array.BYTES_PER_ELEMENT,
            );
            device.queue.writeBuffer(
              buffers.inPlace,
              0,
              createPaddedWave(fixture.wave),
            );
          } else {
            device.queue.writeBuffer(buffers.wave, 0, fixture.wave);
          }

          const fourier = fourierCell.get({
            wave,
            spectrum,
            config: {
              windowSize: fixture.windowSize,
              windowCount,
            },
          });
          const encoder = device.createCommandEncoder();
          fourier.run(encoder);
          const command = encoder.finish();
          device.queue.submit([command]);
          await device.queue.onSubmittedWorkDone();
          const outputBuffer = await reader.read(spectrum);
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
  });

  allIFourierModes.forEach((mode) => {
    if (!isIFourierFixtureSupported(device, mode, fixture.windowSize)) {
      return;
    }

    transformKinds.forEach((transformKind) => {
      it(`${mode} ${transformKind}`, async () => {
        const buffers = createIFourierBuffers(device, {
          windowSize: fixture.windowSize,
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
          const inPlace = transformKind === 'in-place';
          const spectrum = inPlace ? buffers.inPlace : buffers.spectrum;
          const wave = inPlace ? buffers.inPlace : buffers.wave;
          device.queue.writeBuffer(
            spectrum,
            0,
            createInterleavedSpectrum(fixture.spectrum, fixture.windowSize),
          );

          const ifft = ifftCell.get({
            wave,
            spectrum,
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

          const result = new Float32Array(await reader.read(wave));
          assertArrayClose('wave', result, fixture.wave);
        } finally {
          ifftCell.dispose();
          reader.destroy();
          buffers.destroy();
        }
      });
    });
  });
};

Object.entries(fixtures).forEach((entry) => {
  const [rawWindowSize, group] = entry;
  const windowSize = Number(rawWindowSize);

  if (!group) return;

  const factorization = formatRadixStages(windowSize);

  describe(`Fourier ${factorization}-point`, () => {
    for (const fixture of group) {
      describe(fixture.caseName, () => {
        runFourierTests(fixture);
      });
    }
  });
});
