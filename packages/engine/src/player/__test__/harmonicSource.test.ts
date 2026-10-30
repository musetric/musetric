import { describe, expect, it } from 'vitest';
import { createHarmonicSource } from '../harmonicSource.worklet.js';

const sampleRate = 48_000;
const fundamental = 220;
const blockSize = 128;
const hopSeconds = 0.005;

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

const amplitudeAt = (samples: Float32Array, frequency: number) =>
  (2 * Math.sqrt(goertzelPower(samples, frequency))) / samples.length;

const filterTake = (tempoRatio: number) => {
  const source = createHarmonicSource(sampleRate);
  source.setHarmonics([2]);
  const voicedFrames = Math.round(1 / hopSeconds);
  source.setFundamentalFrames({
    trackKey: 'recording',
    firstFrame: 0,
    hopSeconds,
    values: new Float32Array(voicedFrames * 4).fill(
      fundamental,
      0,
      voicedFrames,
    ),
  });
  const length = Math.round(1.5 * sampleRate);
  const output = new Float32Array(length);
  for (let start = 0; start < length; start += blockSize) {
    const block = Float32Array.from({ length: blockSize }, (_, offset) =>
      tone(start + offset, [0.5, 1, 0.4, 0.3]),
    );
    source.filterVoice(block, start * tempoRatio, tempoRatio);
    output.set(block.subarray(0, Math.min(blockSize, length - start)), start);
  }
  return output.subarray(sampleRate, length);
};

describe('harmonic source', () => {
  it('filters the take by its pitch at the song time of each sample', () => {
    const slow = filterTake(0.5);
    expect(amplitudeAt(slow, fundamental * 2)).toBeGreaterThan(0.8);
    expect(amplitudeAt(slow, fundamental)).toBeLessThan(0.05);
    expect(amplitudeAt(slow, fundamental * 3)).toBeLessThan(0.05);

    const fast = filterTake(2);
    expect(amplitudeAt(fast, fundamental * 2)).toBeLessThan(0.05);
  });
});
