import { createGpuContext } from '@musetric/utils/gpu';
import { describe, expect, it } from 'vitest';
import {
  assertArrayClose,
  getMagnitudes,
  getPeak,
  getPeakBin,
  logFloor,
  runCqt,
} from './common.js';
import {
  addSignals,
  cqtToneFixtures,
  createTone,
  getBinFrequency,
} from './fixture.js';
import { referenceCqtConfig } from './plan.js';

const { device } = await createGpuContext();
const { nBins } = referenceCqtConfig;

describe('CQT silence', () => {
  it('goes to the log floor in every bin', async () => {
    const { log, frameCount } = await runCqt(device, new Float32Array(4096));
    expect(frameCount).toBe(3);
    assertArrayClose(
      'silence',
      log,
      new Float32Array(frameCount * nBins).fill(Math.log(logFloor)),
      1e-5,
    );
  });
});

describe('CQT tones', () => {
  describe.each(cqtToneFixtures)('$caseName', (fixture) => {
    it('peaks at its own bin in every steady frame', async () => {
      const { getRow, frameCount } = await runCqt(device, fixture.samples);
      for (let frame = 2; frame < frameCount - 2; frame++) {
        expect(getPeakBin(getRow(frame)), `frame ${frame}`).toBe(fixture.bin);
      }
    });

    it('matches the librosa peak magnitude', async () => {
      const { getRow, frameCount } = await runCqt(device, fixture.samples);
      const row = getMagnitudes(getRow(Math.floor(frameCount / 2)));
      expect(row[fixture.bin]).toBeCloseTo(fixture.peakMagnitude, 2);
    });
  });

  it('splits a tone between two bins onto one of them', async () => {
    const { getRow, frameCount } = await runCqt(
      device,
      createTone(getBinFrequency(60.5), 0.5),
    );
    expect([60, 61]).toContain(getPeakBin(getRow(Math.floor(frameCount / 2))));
  });
});

describe('CQT superposition', () => {
  it('keeps a peak on each of two distant tones', async () => {
    const low = createTone(getBinFrequency(36), 0.4);
    const high = createTone(getBinFrequency(108), 0.4);
    const { getRow, frameCount } = await runCqt(device, addSignals(low, high));
    const row = getRow(Math.floor(frameCount / 2));
    for (const bin of [36, 108]) {
      expect(row[bin], `bin ${bin} is a local peak`).toBeGreaterThan(
        Math.max(row[bin - 1], row[bin + 1]),
      );
    }
  });
});

describe('CQT linearity', () => {
  it('scales magnitude with input amplitude', async () => {
    const frequency = getBinFrequency(72);
    const single = await runCqt(device, createTone(frequency, 0.25));
    const double = await runCqt(device, createTone(frequency, 0.5));
    const doubled = getMagnitudes(single.log).map((value) => 2 * value);
    assertArrayClose(
      'doubled amplitude',
      getMagnitudes(double.log),
      doubled,
      1e-3 * getPeak(doubled),
    );
  });
});
