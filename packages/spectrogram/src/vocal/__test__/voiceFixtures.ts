import { analyzeVocalVoice, type VocalVoice } from '../voice.js';

export const sampleRate = 48_000;
const hopSeconds = 0.005;
const voicedAmplitude = 0.05;
const defaultHarmonics = [1, 0.6, 0.4, 0.3, 0.2, 0.15, 0.1, 0.08];

const createNoise = (seed: number) => {
  let state = seed;
  let previous = 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    const white = state / 2_147_483_648 - 1;
    const bright = white - previous;
    previous = white;
    return bright;
  };
};

const overshootSeconds = 0.08;

export type PitchStep = {
  at: number;
  cents: number;
  seconds: number;
  overshootCents?: number;
};

const stepCents = (step: PitchStep, local: number): number => {
  if (local < step.at) {
    return 0;
  }
  const moved = local - step.at;
  const progress = step.seconds > 0 ? Math.min(1, moved / step.seconds) : 1;
  const after = moved - step.seconds;
  const bump =
    after > 0 && after < overshootSeconds
      ? (step.overshootCents ?? 0) *
        Math.sin((Math.PI * after) / overshootSeconds)
      : 0;
  return step.cents * progress + Math.sign(step.cents) * bump;
};

export type ToneSpec = {
  start: number;
  duration: number;
  frequency: number;
  harmonics?: readonly number[];
  gain?: number;
  riseSeconds?: number;
  fallSeconds?: number;
  scoopCents?: number;
  scoopSeconds?: number;
  fallCents?: number;
  vibrato?: { rate: number; extentCents: number; delay: number };
  steps?: readonly PitchStep[];
  breath?: number;
};

const toneFrequency = (tone: ToneSpec, time: number): number => {
  const local = time - tone.start;
  let cents = 0;
  if (tone.scoopCents && tone.scoopSeconds && local < tone.scoopSeconds) {
    cents += tone.scoopCents * (1 - local / tone.scoopSeconds);
  }
  if (tone.fallCents && tone.fallSeconds) {
    const fallStart = tone.duration - tone.fallSeconds;
    if (local > fallStart) {
      cents += (tone.fallCents * (local - fallStart)) / tone.fallSeconds;
    }
  }
  if (tone.vibrato && local > tone.vibrato.delay) {
    cents +=
      (tone.vibrato.extentCents / 2) *
      Math.sin(2 * Math.PI * tone.vibrato.rate * (local - tone.vibrato.delay));
  }
  for (const step of tone.steps ?? []) {
    cents += stepCents(step, local);
  }
  return tone.frequency * 2 ** (cents / 1200);
};

const toneEnvelope = (tone: ToneSpec, time: number): number => {
  const local = time - tone.start;
  if (local < 0 || local > tone.duration) {
    return 0;
  }
  const rise = tone.riseSeconds ?? 0.005;
  const fall = tone.fallSeconds ?? 0.02;
  const gain = tone.gain ?? 0.5;
  return gain * Math.min(1, local / rise, (tone.duration - local) / fall);
};

export type NoiseSpec = {
  start: number;
  duration: number;
  level: number;
};

export type SyntheticVoice = {
  samples: Float32Array;
  pitch: Float32Array;
};

export const synthesizeVoice = (
  seconds: number,
  tones: readonly ToneSpec[],
  noises: readonly NoiseSpec[] = [],
): SyntheticVoice => {
  const samples = new Float32Array(Math.round(seconds * sampleRate));
  const noise = createNoise(7);
  for (const tone of tones) {
    const harmonics = tone.harmonics ?? defaultHarmonics;
    let phase = 0;
    const from = Math.floor(tone.start * sampleRate);
    const to = Math.min(
      samples.length,
      Math.ceil((tone.start + tone.duration) * sampleRate),
    );
    for (let index = from; index < to; index += 1) {
      const time = index / sampleRate;
      phase += (2 * Math.PI * toneFrequency(tone, time)) / sampleRate;
      const envelope = toneEnvelope(tone, time);
      let value = 0;
      harmonics.forEach((amplitude, harmonic) => {
        value += amplitude * Math.sin((harmonic + 1) * phase);
      });
      samples[index] += envelope * (value + (tone.breath ?? 0) * noise());
    }
  }
  for (const item of noises) {
    const from = Math.floor(item.start * sampleRate);
    const to = Math.ceil((item.start + item.duration) * sampleRate);
    for (let index = from; index < to; index += 1) {
      samples[index] += item.level * noise();
    }
  }
  const frameCount = Math.floor(seconds / hopSeconds);
  const pitch = Float32Array.from({ length: frameCount }, (_, frame) => {
    const time = frame * hopSeconds;
    const tone = tones.find(
      (item) =>
        toneEnvelope(item, time) >= voicedAmplitude * (item.gain ?? 0.5),
    );
    return tone ? toneFrequency(tone, time) : 0;
  });
  return { samples, pitch };
};

export const analyzeSynthetic = async (
  voice: SyntheticVoice,
): Promise<VocalVoice> =>
  analyzeVocalVoice({
    samples: voice.samples,
    sampleRate,
    line: {
      hopSeconds,
      firstFrame: 0,
      values: voice.pitch,
      confidence: new Float32Array(voice.pitch.length).fill(1),
    },
    pause: async () => Promise.resolve(),
    songSample: (sample) => sample,
  });
