import { referenceCqtConfig } from './plan.js';
import {
  cqtToneAmplitude,
  cqtToneReferences,
  cqtToneSeconds,
} from './reference.js';

const { sampleRate, fmin, binsPerOctave } = referenceCqtConfig;

export const getBinFrequency = (bin: number): number =>
  fmin * 2 ** (bin / binsPerOctave);

export const createTone = (
  frequency: number,
  amplitude: number,
  seconds: number = cqtToneSeconds,
): Float32Array => {
  const sampleCount = Math.round(sampleRate * seconds);
  const samples = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index++) {
    samples[index] =
      amplitude * Math.sin((2 * Math.PI * frequency * index) / sampleRate);
  }
  return samples;
};

export const addSignals = (
  left: Float32Array,
  right: Float32Array,
): Float32Array => left.map((value, index) => value + right[index]);

export type CqtToneFixture = {
  caseName: string;
  bin: number;
  peakMagnitude: number;
  samples: Float32Array;
};

export const cqtToneFixtures: CqtToneFixture[] = cqtToneReferences.map(
  (reference) => ({
    caseName: `bin ${reference.bin} (${getBinFrequency(reference.bin).toFixed(1)} Hz)`,
    bin: reference.bin,
    peakMagnitude: reference.peakMagnitude,
    samples: createTone(getBinFrequency(reference.bin), cqtToneAmplitude),
  }),
);
