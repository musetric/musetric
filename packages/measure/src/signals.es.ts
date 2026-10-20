import { transformInPlace } from './dsp/fft.es.js';
import { designButterworthBandPass, filterSections } from './dsp/filters.es.js';
import { getRms } from './dsp/stats.es.js';

const vowelNotes = [
  220, 246.94, 261.63, 293.66, 329.63, 293.66, 261.63, 246.94,
];
const vowelHarmonicCount = 10;
const vowelVibratoDepth = 0.003;
const vowelVibratoRate = 5.5;
const vowelPeak = 0.25;

export const createVowelTone = (sampleRate: number): Float32Array => {
  const tone = new Float32Array(vowelNotes.length * sampleRate);
  let phase = 0;
  vowelNotes.forEach((frequency, note) => {
    for (let index = 0; index < sampleRate; index += 1) {
      const vibrato =
        1 +
        vowelVibratoDepth *
          Math.sin((2 * Math.PI * vowelVibratoRate * index) / sampleRate);
      phase += (2 * Math.PI * frequency * vibrato) / sampleRate;
      let value = 0;
      for (let harmonic = 1; harmonic <= vowelHarmonicCount; harmonic += 1) {
        value += (0.6 / harmonic) * Math.sin(harmonic * phase);
      }
      tone[note * sampleRate + index] = value;
    }
  });
  const peak = tone.reduce((top, value) => Math.max(top, Math.abs(value)), 0);
  return tone.map((value) => (vowelPeak * value) / peak);
};

const createRandom = (seed: number) => {
  let state = seed >>> 0;
  const uniform = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  return () =>
    Math.sqrt(-2 * Math.log(1 - uniform())) * Math.cos(2 * Math.PI * uniform());
};

const createWhite = (random: () => number, length: number) =>
  Float64Array.from({ length }, random);

const createPink = (random: () => number, length: number) => {
  let size = 1;
  while (size < length) {
    size <<= 1;
  }
  const re = createWhite(random, size);
  const im = new Float64Array(size);
  transformInPlace(re, im, 1);
  for (let bin = 1; bin < size; bin += 1) {
    const scale = 1 / Math.sqrt(Math.min(bin, size - bin));
    re[bin] *= scale;
    im[bin] *= scale;
  }
  transformInPlace(re, im, -1);
  return re.subarray(0, length);
};

const setLevel = (samples: ArrayLike<number>, decibels: number) => {
  const gain = 10 ** (decibels / 20) / getRms(samples);
  return Float64Array.from(samples, (value) => value * gain);
};

const applyHann = (samples: Float64Array) =>
  samples.map(
    (value, index) =>
      value *
      (0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (samples.length - 1))),
  );

export const sibilantTestLayout = {
  leadSeconds: 0.5,
  noiseSeconds: 8,
  gapSeconds: 1,
  speechSeconds: 6,
  tailSeconds: 0.5,
};

const sibilantSeed = 11;
const noiseLevel = -20;
const speechLevel = -18;
const vowelFrequency = 220;
const vowelHarmonics = 17;
const vowelSeconds = 0.25;
const vowelPauseSeconds = 0.05;
const burstSeconds = 0.15;
const burstPauseSeconds = 0.15;

const createSpeechPattern = (random: () => number, sampleRate: number) => {
  const vowelLength = Math.round(vowelSeconds * sampleRate);
  const vowel = new Float64Array(vowelLength);
  for (let index = 0; index < vowelLength; index += 1) {
    for (let harmonic = 1; harmonic <= vowelHarmonics; harmonic += 1) {
      vowel[index] +=
        Math.sin(
          (2 * Math.PI * vowelFrequency * harmonic * index) / sampleRate,
        ) / harmonic;
    }
  }
  const burst = filterSections(
    createWhite(random, Math.round(burstSeconds * sampleRate)),
    designButterworthBandPass(5000, 11000, sampleRate),
  );
  return [
    setLevel(applyHann(vowel), speechLevel),
    new Float64Array(Math.round(vowelPauseSeconds * sampleRate)),
    setLevel(applyHann(burst), speechLevel),
    new Float64Array(Math.round(burstPauseSeconds * sampleRate)),
  ];
};

const joinParts = (parts: readonly ArrayLike<number>[]) => {
  const joined = new Float32Array(
    parts.reduce((sum, part) => sum + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
};

export const createSibilantTest = (sampleRate: number): Float32Array => {
  const random = createRandom(sibilantSeed);
  const layout = sibilantTestLayout;
  const noise = filterSections(
    createPink(random, (layout.noiseSeconds + 1) * sampleRate),
    designButterworthBandPass(100, 16000, sampleRate),
  ).subarray(sampleRate);
  const pattern = createSpeechPattern(random, sampleRate);
  const patternSeconds =
    vowelSeconds + vowelPauseSeconds + burstSeconds + burstPauseSeconds;
  const repeats = Math.round(layout.speechSeconds / patternSeconds);
  return joinParts([
    new Float64Array(layout.leadSeconds * sampleRate),
    setLevel(noise, noiseLevel),
    new Float64Array(layout.gapSeconds * sampleRate),
    ...Array.from({ length: repeats }, () => pattern).flat(),
    new Float64Array(layout.tailSeconds * sampleRate),
  ]);
};
