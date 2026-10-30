import { describe, expect, it } from 'vitest';
import { createHarmonicFilter } from '../harmonic/harmonicFilter.es.js';

const sampleRate = 44_100;
const fundamental = 220;

const tone = (index: number, amplitudes: number[]) =>
  amplitudes.reduce(
    (sum, amplitude, harmonic) =>
      sum +
      amplitude *
        Math.sin(
          (2 * Math.PI * fundamental * (harmonic + 1) * index) / sampleRate,
        ),
    0,
  );

const goertzelPower = (samples: Float32Array, frequency: number) => {
  const coefficient = 2 * Math.cos((2 * Math.PI * frequency) / sampleRate);
  let previous = 0;
  let beforePrevious = 0;
  for (const value of samples) {
    const current = value + coefficient * previous - beforePrevious;
    beforePrevious = previous;
    previous = current;
  }
  return (
    previous * previous +
    beforePrevious * beforePrevious -
    coefficient * previous * beforePrevious
  );
};

const filterTone = (harmonics: number[]) => {
  const filter = createHarmonicFilter(sampleRate, 1);
  filter.setHarmonics(harmonics);
  const input = new Float32Array(1);
  const output = new Float32Array(1);
  const length = sampleRate * 2;
  const result = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    input[0] = tone(index, [0.5, 1, 0.4, 0.3]);
    filter.process(fundamental, input, output);
    result[index] = output[0];
  }
  return result.subarray(sampleRate / 2);
};

describe('harmonic filter', () => {
  it('keeps only the chosen harmonics of the fundamental', () => {
    const settled = filterTone([1, 3]);
    const first = goertzelPower(settled, fundamental);
    const third = goertzelPower(settled, fundamental * 3);
    const second = goertzelPower(settled, fundamental * 2);
    const fourth = goertzelPower(settled, fundamental * 4);
    expect(Math.min(first, third)).toBeGreaterThan(second * 100);
    expect(Math.min(first, third)).toBeGreaterThan(fourth * 100);
  });
});
