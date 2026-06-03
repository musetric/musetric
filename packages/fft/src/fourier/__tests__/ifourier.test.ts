import {
  createGpuBufferReader,
  createGpuContext,
} from '@musetric/resource-utils/gpu';
import { describe, it } from 'vitest';
import { allIFourierModes, type IFourierMode } from '../config.es.js';
import { getPackedStockhamC2rVariant } from '../ifftPackedStockhamC2r/support.js';
import { iffts } from '../iffts.js';
import { assertArrayClose, windowCount } from './common.js';
import { fourierFixtures } from './fixture.js';

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

describe('ifourier', async () => {
  const { device } = await createGpuContext();

  for (const mode of allIFourierModes) {
    describe(mode, () => {
      for (const fixture of fourierFixtures) {
        describe(`IFFT ${fixture.windowSize}-point: ${fixture.caseName}`, () => {
          if (!isIFourierFixtureSupported(device, mode, fixture.windowSize)) {
            it.skip('inverse', () => undefined);
            return;
          }

          it('inverse', async () => {
            const spectrumReal = device.createBuffer({
              label: 'test-c2r-spectrum-real',
              size: fixture.spectrum.real.byteLength,
              usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });
            const spectrumImag = device.createBuffer({
              label: 'test-c2r-spectrum-imag',
              size: fixture.spectrum.imag.byteLength,
              usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });
            const wave = device.createBuffer({
              label: 'test-c2r-wave',
              size: fixture.wave.byteLength,
              usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
            });
            const reader = createGpuBufferReader({
              device,
              typeSize: Float32Array.BYTES_PER_ELEMENT,
              size: fixture.windowSize,
            });
            const createIFourierCell = iffts[mode];
            const ifftCell = createIFourierCell(device);

            try {
              device.queue.writeBuffer(spectrumReal, 0, fixture.spectrum.real);
              device.queue.writeBuffer(spectrumImag, 0, fixture.spectrum.imag);

              const ifft = ifftCell.get({
                wave,
                spectrum: { real: spectrumReal, imag: spectrumImag },
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
              spectrumReal.destroy();
              spectrumImag.destroy();
              wave.destroy();
              reader.destroy();
            }
          });
        });
      }
    });
  }
});
