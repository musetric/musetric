import { describe, expect, it } from 'vitest';
import { createCpuFft } from '../cpuFft.es.js';

const naiveDft = (input: Float64Array) => {
  const size = input.length;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let bin = 0; bin < size; bin += 1) {
    for (let index = 0; index < size; index += 1) {
      const angle = (-2 * Math.PI * bin * index) / size;
      re[bin] += input[index] * Math.cos(angle);
      im[bin] += input[index] * Math.sin(angle);
    }
  }
  return { re, im };
};

describe('cpu fft', () => {
  it('matches the direct transform of a real signal', () => {
    const size = 64;
    const input = Float64Array.from(
      { length: size },
      (_, index) => Math.sin(index * 0.7) + 0.3 * Math.cos(index * 2.1),
    );
    const expected = naiveDft(input);
    const re = Float64Array.from(input);
    const im = new Float64Array(size);
    createCpuFft(size)(re, im);
    for (let bin = 0; bin < size; bin += 1) {
      expect(re[bin]).toBeCloseTo(expected.re[bin], 9);
      expect(im[bin]).toBeCloseTo(expected.im[bin], 9);
    }
  });
});
