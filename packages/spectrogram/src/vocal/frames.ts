const bodyCutoffFrequency = 1500;
const butterworthStageQs = [0.5412, 1.3066];
const filterWarmupSamples = 2048;
const powerFloor = 1e-12;

const toDecibel = (power: number): number =>
  10 * Math.log10(power + powerFloor);

type Biquad = { b0: number; b1: number; b2: number; a1: number; a2: number };

const lowPass = (frequency: number, q: number, sampleRate: number): Biquad => {
  const omega = (2 * Math.PI * frequency) / sampleRate;
  const alpha = Math.sin(omega) / (2 * q);
  const cosine = Math.cos(omega);
  const a0 = 1 + alpha;
  const edge = 1 - cosine;
  return {
    b0: edge / 2 / a0,
    b1: edge / a0,
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

export type VocalFrames = {
  sampleRate: number;
  hopSeconds: number;
  firstFrame: number;
  pitch: Float32Array;
  body: Float32Array;
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
  const energies = blockEnergies({
    samples,
    hop,
    firstBlock: line.firstFrame - 1,
    blockCount: count + 1,
    stages: butterworthStageQs.map((q) =>
      lowPass(bodyCutoffFrequency, q, sampleRate),
    ),
  });
  await pause();
  return {
    sampleRate,
    hopSeconds: line.hopSeconds,
    firstFrame: line.firstFrame,
    pitch: Float32Array.from(line.values),
    body: Float32Array.from({ length: count }, (_, index) =>
      toDecibel((energies[index] + energies[index + 1]) / (2 * hop)),
    ),
  };
};
