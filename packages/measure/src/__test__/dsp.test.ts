import { describe, expect, it } from 'vitest';
import { getClickScore } from '../dsp/clicks.es.js';
import { findEnvelopeOffset } from '../dsp/envelope.es.js';
import { transformInPlace } from '../dsp/fft.es.js';
import {
  designButterworthBandPass,
  filterSections,
  getSectionsResponse,
} from '../dsp/filters.es.js';
import { getThirdOctaveLevels, getWelchDensity } from '../dsp/spectrum.es.js';
import { getPercentile, getRms } from '../dsp/stats.es.js';

const sampleRate = 48000;

const createSine = (frequency: number, length: number, amplitude: number) =>
  Float64Array.from(
    { length },
    (_, index) =>
      amplitude * Math.sin((2 * Math.PI * frequency * index) / sampleRate),
  );

const createNoise = (length: number, seed: number) => {
  let state = seed;
  return Float64Array.from({ length }, () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 1073741824 - 1;
  });
};

describe('percentiles', () => {
  it('interpolates between ranks like numpy', () => {
    expect(getPercentile([4, 1, 3, 2], 50)).toBeCloseTo(2.5);
    expect(getPercentile([4, 1, 3, 2], 10)).toBeCloseTo(1.3);
    expect(getPercentile([4, 1, 3, 2], 100)).toBe(4);
  });
});

describe('fft', () => {
  it('finds a sine in its bin and inverts back', () => {
    const size = 1024;
    const re = Float64Array.from({ length: size }, (_, index) =>
      Math.cos((2 * Math.PI * 8 * index) / size),
    );
    const original = re.slice();
    const im = new Float64Array(size);
    transformInPlace(re, im, 1);
    expect(re[8]).toBeCloseTo(size / 2);
    expect(re[size - 8]).toBeCloseTo(size / 2);
    expect(Math.abs(re[9])).toBeLessThan(1e-9);
    transformInPlace(re, im, -1);
    original.forEach((value, index) => {
      expect(re[index]).toBeCloseTo(value, 9);
    });
  });
});

describe('butterworth band-pass', () => {
  const sections = designButterworthBandPass(5000, 11000, sampleRate);

  it('passes the band and halves the power at its edges', () => {
    expect(sections).toHaveLength(4);
    expect(getSectionsResponse(sections, 5000, sampleRate)).toBeCloseTo(
      Math.SQRT1_2,
      4,
    );
    expect(getSectionsResponse(sections, 11000, sampleRate)).toBeCloseTo(
      Math.SQRT1_2,
      4,
    );
    expect(getSectionsResponse(sections, 7500, sampleRate)).toBeCloseTo(1, 2);
    expect(getSectionsResponse(sections, 1000, sampleRate)).toBeLessThan(1e-3);
  });

  it('filters a sine by the designed response', () => {
    const sine = createSine(4000, sampleRate, 1);
    const filtered = filterSections(sine, sections).subarray(sampleRate / 2);
    expect(getRms(filtered) * Math.SQRT2).toBeCloseTo(
      getSectionsResponse(sections, 4000, sampleRate),
      3,
    );
  });
});

describe('welch density', () => {
  it('keeps the power of a sine in its third octave', () => {
    const sine = createSine(1000, 8 * sampleRate, 0.5);
    const [level] = getThirdOctaveLevels(
      getWelchDensity(sine, sampleRate, 8192),
      [1000],
    );
    const bandWidth = sampleRate / 8192;
    expect(level + 10 * Math.log10(bandWidth)).toBeCloseTo(
      10 * Math.log10(0.125),
      1,
    );
  });

  it('spreads white noise evenly', () => {
    const noise = createNoise(8 * sampleRate, 7);
    const spectrum = getWelchDensity(noise, sampleRate, 8192);
    const variance = getRms(noise) ** 2;
    const total = spectrum.density.reduce(
      (sum, value) => sum + (value * sampleRate) / 8192,
      0,
    );
    expect(total / variance).toBeCloseTo(1, 1);
  });
});

describe('envelope alignment', () => {
  it('finds where the reference sits', () => {
    const reference = Float64Array.from(
      { length: 300 },
      (_, index) => (index * 37) % 23,
    );
    const envelope = new Float64Array(1000).fill(-80);
    envelope.set(reference, 412);
    expect(findEnvelopeOffset(envelope, reference).offset).toBe(412);
  });
});

describe('click score', () => {
  it('matches the direct correlation with the click', () => {
    const signal = createNoise(6000, 3);
    const score = getClickScore(signal, sampleRate);
    const length = Math.round(0.05 * sampleRate);
    for (const start of [0, 1234, score.length - 1]) {
      let best = 0;
      for (const frequency of [880, 1320]) {
        let re = 0;
        let im = 0;
        for (let index = 0; index < length; index += 1) {
          const envelope = Math.exp(-index / (0.015 * sampleRate));
          const angle = (2 * Math.PI * frequency * index) / sampleRate;
          re += signal[start + index] * envelope * Math.cos(angle);
          im += signal[start + index] * envelope * Math.sin(angle);
        }
        best = Math.max(best, Math.hypot(re, im));
      }
      expect(score[start]).toBeCloseTo(best, 6);
    }
  });
});
