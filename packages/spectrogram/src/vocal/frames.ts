import { createCpuFft, windowFunctions } from '@musetric/fft';

const airCutoffFrequency = 3000;
const bodyCutoffFrequency = 1500;
const butterworthStageQs = [0.5412, 1.3066];
const filterWarmupSamples = 2048;
const spectralWindowSize = 2048;
const spectralStride = 4;
const maxHarmonics = 24;
const maxHarmonicFrequency = 6000;
const harmonicSearchRatio = 0.2;
const cepstrumMinSeconds = 0.001;
const cepstrumMaxSeconds = 1 / 60;
const cepstrumSearchRatio = 0.1;
const cepstrumMaxFrequency = 6000;
const ringMinFrequency = 2000;
const ringMaxFrequency = 4000;
const ringBaseFrequency = 1000;
const powerFloor = 1e-12;
const pauseFrames = 256;

const toDecibel = (power: number): number =>
  10 * Math.log10(power + powerFloor);

type Biquad = { b0: number; b1: number; b2: number; a1: number; a2: number };

type BiquadShape = 'lowPass' | 'highPass';

const biquad = (
  shape: BiquadShape,
  frequency: number,
  q: number,
  sampleRate: number,
): Biquad => {
  const omega = (2 * Math.PI * frequency) / sampleRate;
  const alpha = Math.sin(omega) / (2 * q);
  const cosine = Math.cos(omega);
  const a0 = 1 + alpha;
  const edge = shape === 'lowPass' ? 1 - cosine : 1 + cosine;
  return {
    b0: edge / 2 / a0,
    b1: (shape === 'lowPass' ? edge : -edge) / a0,
    b2: edge / 2 / a0,
    a1: (-2 * cosine) / a0,
    a2: (1 - alpha) / a0,
  };
};

const createFilter = (stages: readonly Biquad[]) => {
  const state = new Float64Array(stages.length * 4);
  return (input: number): number => {
    let value = input;
    for (let index = 0; index < stages.length; index += 1) {
      const stage = stages[index];
      const base = index * 4;
      const output =
        stage.b0 * value +
        stage.b1 * state[base] +
        stage.b2 * state[base + 1] -
        stage.a1 * state[base + 2] -
        stage.a2 * state[base + 3];
      state[base + 1] = state[base];
      state[base] = value;
      state[base + 3] = state[base + 2];
      state[base + 2] = output;
      value = output;
    }
    return value;
  };
};

type EnvelopeInput = {
  samples: Float32Array;
  hop: number;
  firstBlock: number;
  blockCount: number;
  stages: readonly Biquad[];
};

const blockEnergies = (input: EnvelopeInput): Float64Array => {
  const { samples, hop, firstBlock, blockCount, stages } = input;
  const energies = new Float64Array(blockCount);
  const filter = createFilter(stages);
  const start = firstBlock * hop;
  const end = start + blockCount * hop;
  for (let index = start - filterWarmupSamples; index < end; index += 1) {
    const value = filter(samples[index] ?? 0);
    if (index >= start) {
      energies[Math.floor((index - start) / hop)] += value * value;
    }
  }
  return energies;
};

const frameLevels = (input: EnvelopeInput, count: number): Float32Array => {
  const energies = blockEnergies(input);
  return Float32Array.from({ length: count }, (_, index) =>
    toDecibel((energies[index] + energies[index + 1]) / (2 * input.hop)),
  );
};

const createSpectralMeter = (samples: Float32Array, sampleRate: number) => {
  const fft = createCpuFft(spectralWindowSize);
  const window = windowFunctions.hann(spectralWindowSize);
  const re = new Float64Array(spectralWindowSize);
  const im = new Float64Array(spectralWindowSize);
  const power = new Float64Array(spectralWindowSize / 2);
  const binWidth = sampleRate / spectralWindowSize;
  const lastBin = power.length - 1;

  const peak = (frequency: number, halfWidth: number) => {
    const from = Math.min(
      lastBin,
      Math.max(1, Math.round((frequency - halfWidth) / binWidth)),
    );
    const to = Math.max(
      from,
      Math.min(lastBin, Math.round((frequency + halfWidth) / binWidth)),
    );
    let value = power[from];
    for (let bin = from + 1; bin <= to; bin += 1) {
      value = Math.max(value, power[bin]);
    }
    return value;
  };

  const cepstrumBins =
    2 ** Math.round(Math.log2(cepstrumMaxFrequency / binWidth));
  const cepstrumSize = 2 * cepstrumBins;
  const cepstrumFft = createCpuFft(cepstrumSize);
  const cepstrumRe = new Float64Array(cepstrumSize);
  const cepstrumIm = new Float64Array(cepstrumSize);
  const secondsPerQuefrency = spectralWindowSize / (sampleRate * cepstrumSize);
  const cepstrumFrom = Math.round(cepstrumMinSeconds / secondsPerQuefrency);
  const cepstrumTo = Math.min(
    cepstrumBins - 1,
    Math.round(cepstrumMaxSeconds / secondsPerQuefrency),
  );

  const regression = () => {
    let count = 0;
    let sumQuefrency = 0;
    let sumValue = 0;
    let sumProduct = 0;
    let sumSquare = 0;
    for (
      let quefrency = cepstrumFrom;
      quefrency <= cepstrumTo;
      quefrency += 1
    ) {
      const value = cepstrumRe[quefrency] / cepstrumSize;
      count += 1;
      sumQuefrency += quefrency;
      sumValue += value;
      sumProduct += quefrency * value;
      sumSquare += quefrency * quefrency;
    }
    const slope =
      (count * sumProduct - sumQuefrency * sumValue) /
      (count * sumSquare - sumQuefrency * sumQuefrency);
    return { slope, intercept: (sumValue - slope * sumQuefrency) / count };
  };

  const cepstralPeakProminence = (fundamental: number) => {
    for (let bin = 0; bin < cepstrumSize; bin += 1) {
      const mirrored = Math.min(
        cepstrumBins - 1,
        Math.min(bin, cepstrumSize - bin),
      );
      cepstrumRe[bin] = toDecibel(power[mirrored]);
      cepstrumIm[bin] = 0;
    }
    cepstrumFft(cepstrumRe, cepstrumIm);
    const { slope, intercept } = regression();
    const period = 1 / fundamental / secondsPerQuefrency;
    const from = Math.max(
      cepstrumFrom,
      Math.round(period * (1 - cepstrumSearchRatio)),
    );
    const to = Math.min(
      cepstrumTo,
      Math.round(period * (1 + cepstrumSearchRatio)),
    );
    let best = from;
    for (let quefrency = from + 1; quefrency <= to; quefrency += 1) {
      best = cepstrumRe[quefrency] > cepstrumRe[best] ? quefrency : best;
    }
    const left = cepstrumRe[best - 1] / cepstrumSize;
    const middle = cepstrumRe[best] / cepstrumSize;
    const right = cepstrumRe[best + 1] / cepstrumSize;
    const curvature = left - 2 * middle + right;
    const shift = curvature < 0 ? (0.5 * (left - right)) / curvature : 0;
    const height = middle - 0.25 * (left - right) * shift;
    return height - (intercept + slope * (best + shift));
  };

  const measureHarmonics = (fundamental: number, harmonics: Float32Array) => {
    let ringPower = 0;
    let basePower = 0;
    for (
      let harmonic = 1;
      harmonic * fundamental <= maxHarmonicFrequency;
      harmonic += 1
    ) {
      const frequency = harmonic * fundamental;
      const value = peak(frequency, harmonicSearchRatio * fundamental);
      if (harmonic <= maxHarmonics) {
        harmonics[harmonic - 1] = toDecibel(value);
      }
      if (frequency < ringBaseFrequency) {
        basePower += value;
      }
      if (frequency >= ringMinFrequency && frequency <= ringMaxFrequency) {
        ringPower += value;
      }
    }
    return toDecibel(ringPower) - toDecibel(basePower);
  };

  return (center: number, fundamental: number, harmonics: Float32Array) => {
    const start = center - spectralWindowSize / 2;
    for (let index = 0; index < spectralWindowSize; index += 1) {
      re[index] = (samples[start + index] ?? 0) * window[index];
      im[index] = 0;
    }
    fft(re, im);
    for (let bin = 0; bin < power.length; bin += 1) {
      power[bin] = re[bin] * re[bin] + im[bin] * im[bin];
    }
    return {
      ring: measureHarmonics(fundamental, harmonics),
      cpp: cepstralPeakProminence(fundamental),
    };
  };
};

export type VocalFrames = {
  sampleRate: number;
  hopSeconds: number;
  firstFrame: number;
  pitch: Float32Array;
  level: Float32Array;
  body: Float32Array;
  air: Float32Array;
  spectralStride: number;
  maxHarmonics: number;
  maxHarmonicFrequency: number;
  harmonics: Float32Array;
  cpp: Float32Array;
  ring: Float32Array;
};

export type VocalPitchLine = {
  hopSeconds: number;
  firstFrame: number;
  values: Float32Array;
  confidence: Float32Array;
};

export type MeasureVocalFramesInput = {
  samples: Float32Array;
  sampleRate: number;
  line: VocalPitchLine;
  pause: () => Promise<void>;
};

export const measureVocalFrames = async (
  input: MeasureVocalFramesInput,
): Promise<VocalFrames> => {
  const { samples, sampleRate, line, pause } = input;
  const hop = Math.round(line.hopSeconds * sampleRate);
  const count = line.values.length;
  const envelope = (stages: readonly Biquad[]) =>
    frameLevels(
      {
        samples,
        hop,
        firstBlock: line.firstFrame - 1,
        blockCount: count + 1,
        stages,
      },
      count,
    );
  const filterStages = (shape: BiquadShape, frequency: number) =>
    butterworthStageQs.map((q) => biquad(shape, frequency, q, sampleRate));

  const level = envelope([]);
  await pause();
  const body = envelope(filterStages('lowPass', bodyCutoffFrequency));
  await pause();
  const air = envelope(filterStages('highPass', airCutoffFrequency));
  await pause();

  const spectralCount = Math.ceil(count / spectralStride);
  const harmonics = new Float32Array(spectralCount * maxHarmonics).fill(
    Number.NaN,
  );
  const cpp = new Float32Array(spectralCount).fill(Number.NaN);
  const ring = new Float32Array(spectralCount).fill(Number.NaN);
  const measure = createSpectralMeter(samples, sampleRate);
  for (let slot = 0; slot < spectralCount; slot += 1) {
    if (slot % pauseFrames === pauseFrames - 1) {
      await pause();
    }
    const index = slot * spectralStride;
    const fundamental = line.values[index];
    if (fundamental <= 0) {
      continue;
    }
    const result = measure(
      (line.firstFrame + index) * hop,
      fundamental,
      harmonics.subarray(slot * maxHarmonics, (slot + 1) * maxHarmonics),
    );
    cpp[slot] = result.cpp;
    ring[slot] = result.ring;
  }

  return {
    sampleRate,
    hopSeconds: line.hopSeconds,
    firstFrame: line.firstFrame,
    pitch: Float32Array.from(line.values),
    level,
    body,
    air,
    spectralStride,
    maxHarmonics,
    maxHarmonicFrequency,
    harmonics,
    cpp,
    ring,
  };
};
