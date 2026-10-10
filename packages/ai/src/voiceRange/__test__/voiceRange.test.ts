import { describe, expect, it } from 'vitest';
import {
  measurePitchRange,
  measureSpectrumBands,
  measureVoiceRange,
  type VoicePitchLine,
} from '../voiceRange.js';

const sampleRate = 48000;
const hopSeconds = 0.005;

const createLine = (values: number[], confidence = 1): VoicePitchLine => ({
  hopSeconds,
  firstFrame: 0,
  values: Float32Array.from(values),
  confidence: new Float32Array(values.length).fill(confidence),
});

const repeat = (value: number, count: number): number[] =>
  new Array<number>(count).fill(value);

const harmonicTone = (
  fundamental: number,
  amplitudes: number[],
  seconds: number,
): Float32Array =>
  Float32Array.from({ length: seconds * sampleRate }, (_, index) =>
    amplitudes.reduce(
      (sum, amplitude, harmonic) =>
        sum +
        amplitude *
          Math.sin(
            (2 * Math.PI * fundamental * (harmonic + 1) * index) / sampleRate,
          ),
      0,
    ),
  );

describe('voice range', () => {
  it('has no pitch range without voiced frames', () => {
    const line = createLine(repeat(0, 100));
    expect(measurePitchRange(line)).toBeUndefined();
    expect(
      measureVoiceRange({ samples: new Float32Array(1000), sampleRate, line }),
    ).toEqual({ bands: [] });
  });

  it('drops a rare tail and keeps the body of the voice', () => {
    const line = createLine([
      ...repeat(110, 300),
      ...repeat(220, 400),
      ...repeat(330, 297),
      ...repeat(55, 2),
      ...repeat(880, 1),
    ]);
    expect(measurePitchRange(line)).toEqual({
      minFrequency: 110,
      maxFrequency: 330,
    });
  });

  it('keeps a tail heavier than the share it may drop', () => {
    const line = createLine([
      ...repeat(110, 300),
      ...repeat(220, 692),
      ...repeat(880, 8),
    ]);
    expect(measurePitchRange(line)).toEqual({
      minFrequency: 110,
      maxFrequency: 880,
    });
  });

  it('weighs frames by their confidence', () => {
    const line = createLine([...repeat(220, 900), ...repeat(660, 100)]);
    line.confidence.fill(0.01, 900);
    expect(measurePitchRange(line)).toEqual({
      minFrequency: 220,
      maxFrequency: 220,
    });
  });

  it('measures the bands of the voiced frames only', () => {
    const seconds = 2;
    const voice = harmonicTone(1250, [0.5, 0.25], seconds);
    const frames = seconds / hopSeconds;
    const line = createLine([
      ...repeat(1250, frames / 2),
      ...repeat(0, frames / 2),
    ]);
    voice.fill(0.5, voice.length / 2);
    const bands = measureSpectrumBands({ samples: voice, sampleRate, line });
    expect(bands).toHaveLength(24);
    expect(bands[0].minFrequency).toBe(1000);
    expect(bands.at(-1)?.maxFrequency).toBeCloseTo(16000, 6);
    const levelAt = (frequency: number): number =>
      bands.find(
        (band) =>
          band.minFrequency <= frequency && frequency < band.maxFrequency,
      )?.levelDb ?? -Infinity;
    expect(levelAt(1250) - levelAt(2500)).toBeCloseTo(6, 0);
    expect(levelAt(10000)).toBeLessThan(levelAt(2500) - 60);
  });
});
