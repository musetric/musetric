import {
  clampEnvelope,
  findEnvelopeOffset,
  getLevelEnvelope,
} from '../dsp/envelope.js';
import { designButterworthBandPass, filterSections } from '../dsp/filters.js';
import { getThirdOctaveLevels, getWelchDensity } from '../dsp/spectrum.js';
import { getMaximum, getPeak, getRms, toDecibels } from '../dsp/stats.js';

export const bandCenters = [
  125, 250, 500, 1000, 2000, 3150, 4000, 5000, 6300, 8000, 10000, 12500,
];

const alignBlockSeconds = 0.01;
const alignFloor = -80;
const bandWindowSize = 8192;
const noiseSeconds = [1, 8];
const speechSeconds = [10, 15.5];
const pauseSeconds = [
  [0.1, 0.45],
  [8.65, 9.35],
];
const speechBlockSeconds = 0.02;
const limiterLevel = 0.88;

export type SoundSignal = {
  sampleRate: number;
  samples: Float32Array;
};

const slice = (signal: SoundSignal, fromSeconds: number, toSeconds: number) =>
  signal.samples.subarray(
    Math.round(fromSeconds * signal.sampleRate),
    Math.round(toSeconds * signal.sampleRate),
  );

const getEnvelopeMax = (
  samples: ArrayLike<number>,
  sampleRate: number,
  lowFrequency: number,
  highFrequency: number,
) =>
  getMaximum(
    getLevelEnvelope(
      filterSections(
        samples,
        designButterworthBandPass(lowFrequency, highFrequency, sampleRate),
      ),
      sampleRate,
      speechBlockSeconds,
    ),
  );

const getEnvelope = (signal: SoundSignal) =>
  clampEnvelope(
    getLevelEnvelope(signal.samples, signal.sampleRate, alignBlockSeconds),
    alignFloor,
  );

export const alignToReference = (reference: SoundSignal, path: SoundSignal) => {
  const match = findEnvelopeOffset(getEnvelope(path), getEnvelope(reference));
  const offset = match.offset * Math.round(path.sampleRate * alignBlockSeconds);
  const length = Math.round(
    (reference.samples.length / reference.sampleRate) * path.sampleRate,
  );
  return {
    correlation: match.correlation,
    signal: {
      sampleRate: path.sampleRate,
      samples: path.samples.subarray(offset, offset + length),
    },
  };
};

export type SoundPathResult = {
  correlation: number;
  bands: number[];
  vowelLoudest: number;
  sibilantLoudest: number;
  sibilantOverVowel: number;
  peak: number;
  limiterCount: number;
  pauseNoise: number;
};

export const analyzeSoundPath = (
  reference: SoundSignal,
  path: SoundSignal,
): SoundPathResult => {
  const aligned = alignToReference(reference, path);
  const { signal } = aligned;
  const { sampleRate } = signal;
  const bands = getThirdOctaveLevels(
    getWelchDensity(
      slice(signal, noiseSeconds[0], noiseSeconds[1]),
      sampleRate,
      bandWindowSize,
    ),
    bandCenters,
  );
  const speech = slice(signal, speechSeconds[0], speechSeconds[1]);
  const vowelLoudest = getEnvelopeMax(speech, sampleRate, 150, 4000);
  const sibilantLoudest = getEnvelopeMax(speech, sampleRate, 5000, 11000);
  const band = {
    sampleRate,
    samples: Float32Array.from(
      filterSections(
        signal.samples,
        designButterworthBandPass(100, 8000, sampleRate),
      ),
    ),
  };
  const pauses = pauseSeconds.flatMap((pause) => [
    ...slice(band, pause[0], pause[1]),
  ]);
  return {
    correlation: aligned.correlation,
    bands,
    vowelLoudest,
    sibilantLoudest,
    sibilantOverVowel: sibilantLoudest - vowelLoudest,
    peak: toDecibels(getPeak(speech)),
    limiterCount: speech.filter((value) => Math.abs(value) > limiterLevel)
      .length,
    pauseNoise: toDecibels(getRms(pauses)),
  };
};

export type SoundResult = {
  browser: SoundPathResult;
  app: SoundPathResult;
  bandDifference: number[];
};

export const analyzeSound = (
  reference: SoundSignal,
  browser: SoundSignal,
  app: SoundSignal,
): SoundResult => {
  const browserResult = analyzeSoundPath(reference, browser);
  const appResult = analyzeSoundPath(reference, app);
  return {
    browser: browserResult,
    app: appResult,
    bandDifference: appResult.bands.map(
      (level, index) => level - browserResult.bands[index],
    ),
  };
};

const holeSeconds = 0.001;

const getRecordedPart = (samples: Float32Array) => {
  const first = samples.findIndex((value) => value !== 0);
  const last = samples.findLastIndex((value) => value !== 0);
  return first < 0 ? samples.subarray(0, 0) : samples.subarray(first, last + 1);
};

export type HoleResult = {
  holeCount: number;
  longestMs: number;
  rms: number;
};

export const analyzeHoles = (take: SoundSignal): HoleResult => {
  const samples = getRecordedPart(take.samples);
  const minimum = Math.round(holeSeconds * take.sampleRate);
  let holeCount = 0;
  let longest = 0;
  let run = 0;
  for (let index = 0; index <= samples.length; index += 1) {
    if (index < samples.length && samples[index] === 0) {
      run += 1;
      continue;
    }
    if (run >= minimum) {
      holeCount += 1;
    }
    longest = Math.max(longest, run);
    run = 0;
  }
  return {
    holeCount,
    longestMs: (longest / take.sampleRate) * 1000,
    rms: toDecibels(getRms(samples)),
  };
};
