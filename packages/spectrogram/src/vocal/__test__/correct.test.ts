import { describe, expect, it } from 'vitest';
import { renderTakeVersion, type TakeVersion } from '../correct.js';
import {
  analyzeSynthetic,
  sampleRate,
  synthesizeVoice,
  type ToneSpec,
} from './voiceFixtures.js';

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

const rms = (samples: Float32Array) =>
  Math.sqrt(
    samples.reduce((sum, value) => sum + value * value, 0) / samples.length,
  );

const render = async (
  leadTone: ToneSpec,
  takeTone: ToneSpec,
  version: TakeVersion,
) => {
  const takeVoice = synthesizeVoice(2.5, [takeTone]);
  const lead = await analyzeSynthetic(synthesizeVoice(2.5, [leadTone]));
  const take = await analyzeSynthetic(takeVoice);
  return renderTakeVersion({
    lead,
    take,
    takeSamples: takeVoice.samples,
    rawPosition: (sample) => sample,
    start: 0.5,
    end: 2,
    version,
  });
};

const at = (samples: Float32Array, from: number, to: number) =>
  samples.subarray(
    Math.round((from - 0.5) * sampleRate),
    Math.round((to - 0.5) * sampleRate),
  );

describe('take versions', () => {
  it('sings the take on the pitch line of the singer', async () => {
    const output = await render(
      { start: 0.8, duration: 0.9, frequency: 247 },
      { start: 0.8, duration: 0.9, frequency: 220 },
      'pitch',
    );
    const middle = at(output, 1, 1.5);
    expect(goertzelPower(middle, 247)).toBeGreaterThan(
      goertzelPower(middle, 220) * 10,
    );
  });

  it('keeps the pitch of the take in the timing version', async () => {
    const output = await render(
      { start: 0.8, duration: 0.9, frequency: 247 },
      { start: 0.8, duration: 0.9, frequency: 220 },
      'timing',
    );
    const middle = at(output, 1, 1.5);
    expect(goertzelPower(middle, 220)).toBeGreaterThan(
      goertzelPower(middle, 247) * 10,
    );
  });

  it('moves a late take onto the time of the singer', async () => {
    const output = await render(
      { start: 0.8, duration: 0.9, frequency: 220 },
      { start: 0.92, duration: 0.9, frequency: 220 },
      'timing',
    );
    expect(rms(at(output, 0.82, 0.9))).toBeGreaterThan(0.1);
    expect(rms(at(output, 0.6, 0.75))).toBeLessThan(0.01);
  });

  it('gives the take the swell of the singer', async () => {
    const output = await render(
      { start: 0.8, duration: 0.9, frequency: 220, riseSeconds: 0.7 },
      { start: 0.8, duration: 0.9, frequency: 220 },
      'level',
    );
    expect(rms(at(output, 1.5, 1.6))).toBeGreaterThan(
      rms(at(output, 0.95, 1.05)) * 1.8,
    );
  });
});
