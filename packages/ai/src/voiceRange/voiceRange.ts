import { windowFunctions } from '@musetric/fft';
import { fftInPlace } from '../transcription/spectralChunker.js';

const pitchCoverage = 0.995;
const bandWindowSize = 1024;
const bandZeroPaddingFactor = 2;
const bandFrameStride = 4;
const bandLitShare = 0.1;
const bandMinFrequency = 1000;
const bandsPerOctave = 6;
const bandOctaves = 4;
const powerFloor = 1e-12;

export type VoicePitchLine = {
  hopSeconds: number;
  firstFrame: number;
  values: Float32Array;
  confidence: Float32Array;
};

type WeightedPitch = {
  frequency: number;
  weight: number;
};

const voicedPitches = (line: VoicePitchLine): WeightedPitch[] => {
  const pitches: WeightedPitch[] = [];
  line.values.forEach((value, index) => {
    const weight = line.confidence[index];
    if (value > 0 && weight > 0) {
      pitches.push({ frequency: value, weight });
    }
  });
  return pitches.sort((left, right) => left.frequency - right.frequency);
};

export type VoicePitchRange = {
  minFrequency: number;
  maxFrequency: number;
};

export const measurePitchRange = (
  line: VoicePitchLine,
): VoicePitchRange | undefined => {
  const pitches = voicedPitches(line);
  const total = pitches.reduce((sum, pitch) => sum + pitch.weight, 0);
  if (total <= 0) {
    return undefined;
  }
  const needed = total * pitchCoverage;
  let first = 0;
  let held = 0;
  let best = { first: 0, last: pitches.length - 1 };
  pitches.forEach((pitch, last) => {
    held += pitch.weight;
    while (held - pitches[first].weight >= needed) {
      held -= pitches[first].weight;
      first += 1;
    }
    const width = pitch.frequency / pitches[first].frequency;
    const bestWidth =
      pitches[best.last].frequency / pitches[best.first].frequency;
    if (held >= needed && width < bestWidth) {
      best = { first, last };
    }
  });
  return {
    minFrequency: pitches[best.first].frequency,
    maxFrequency: pitches[best.last].frequency,
  };
};

export type VoiceSpectrumBand = {
  minFrequency: number;
  maxFrequency: number;
  levelDb: number;
};

type BandBins = {
  band: Omit<VoiceSpectrumBand, 'levelDb'>;
  firstBin: number;
  lastBin: number;
};

const createBandBins = (sampleRate: number): BandBins[] => {
  const size = bandWindowSize * bandZeroPaddingFactor;
  const binOf = (frequency: number): number => (frequency * size) / sampleRate;
  return Array.from({ length: bandsPerOctave * bandOctaves }, (_, index) => {
    const minFrequency = bandMinFrequency * 2 ** (index / bandsPerOctave);
    const maxFrequency = bandMinFrequency * 2 ** ((index + 1) / bandsPerOctave);
    const firstBin = Math.ceil(binOf(minFrequency));
    return {
      band: { minFrequency, maxFrequency },
      firstBin,
      lastBin: Math.max(firstBin, Math.floor(binOf(maxFrequency))),
    };
  });
};

const createFrameLevels = (samples: Float32Array, sampleRate: number) => {
  const window = windowFunctions.hamming(bandWindowSize);
  const size = bandWindowSize * bandZeroPaddingFactor;
  const halfSize = size / 2;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const bins = createBandBins(sampleRate);
  return {
    bins,
    measure: (centerSample: number): number[] => {
      re.fill(0);
      im.fill(0);
      const start = centerSample - bandWindowSize / 2;
      const from = Math.max(0, -start);
      const to = Math.min(bandWindowSize, samples.length - start);
      for (let index = from; index < to; index += 1) {
        re[index] = samples[start + index] * window[index];
      }
      fftInPlace(re, im);
      return bins.map((bandBins) => {
        let peak = 0;
        for (let bin = bandBins.firstBin; bin <= bandBins.lastBin; bin += 1) {
          peak = Math.max(peak, re[bin] * re[bin] + im[bin] * im[bin]);
        }
        return 10 * Math.log10(peak / halfSize + powerFloor);
      });
    },
  };
};

const litLevel = (levels: number[]): number => {
  const sorted = levels.toSorted((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) * (1 - bandLitShare))];
};

export type VoiceRangeInput = {
  samples: Float32Array;
  sampleRate: number;
  line: VoicePitchLine;
};

export const measureSpectrumBands = (
  input: VoiceRangeInput,
): VoiceSpectrumBand[] => {
  const { samples, sampleRate, line } = input;
  const hop = Math.round(line.hopSeconds * sampleRate);
  const frames = createFrameLevels(samples, sampleRate);
  const levels: number[][] = frames.bins.map(() => []);
  let voiced = 0;
  line.values.forEach((value, index) => {
    if (value <= 0) {
      return;
    }
    voiced += 1;
    if ((voiced - 1) % bandFrameStride !== 0) {
      return;
    }
    frames.measure((line.firstFrame + index) * hop).forEach((level, band) => {
      levels[band].push(level);
    });
  });
  if (voiced === 0) {
    return [];
  }
  return frames.bins.map((bandBins, index) => ({
    ...bandBins.band,
    levelDb: litLevel(levels[index]),
  }));
};

export type VoiceRange = {
  pitch?: VoicePitchRange;
  bands: VoiceSpectrumBand[];
};

export const measureVoiceRange = (input: VoiceRangeInput): VoiceRange => {
  const pitch = measurePitchRange(input.line);
  const bands = measureSpectrumBands(input);
  return pitch ? { pitch, bands } : { bands };
};
