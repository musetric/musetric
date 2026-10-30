import { analyzeVocalVoice, type VocalVoice } from '../voice.js';

const sampleRate = 48_000;
const hopSeconds = 0.005;
const voicedShare = 0.05;
const harmonics = [1, 0.6, 0.4, 0.3, 0.2, 0.15, 0.1, 0.08];
const riseSeconds = 0.005;
const fallSeconds = 0.02;

export type ToneSpec = {
  start: number;
  duration: number;
  frequency: number;
  vibrato?: { rate: number; extentCents: number };
};

const toneFrequency = (tone: ToneSpec, time: number): number => {
  const cents = tone.vibrato
    ? (tone.vibrato.extentCents / 2) *
      Math.sin(2 * Math.PI * tone.vibrato.rate * (time - tone.start))
    : 0;
  return tone.frequency * 2 ** (cents / 1200);
};

const toneEnvelope = (tone: ToneSpec, time: number): number => {
  const local = time - tone.start;
  if (local < 0 || local > tone.duration) {
    return 0;
  }
  return Math.min(
    1,
    local / riseSeconds,
    (tone.duration - local) / fallSeconds,
  );
};

export const analyzeTones = async (
  seconds: number,
  tones: readonly ToneSpec[],
): Promise<VocalVoice> => {
  const samples = new Float32Array(Math.round(seconds * sampleRate));
  for (const tone of tones) {
    let phase = 0;
    const from = Math.floor(tone.start * sampleRate);
    const to = Math.min(
      samples.length,
      Math.ceil((tone.start + tone.duration) * sampleRate),
    );
    for (let index = from; index < to; index += 1) {
      const time = index / sampleRate;
      phase += (2 * Math.PI * toneFrequency(tone, time)) / sampleRate;
      let value = 0;
      harmonics.forEach((amplitude, harmonic) => {
        value += amplitude * Math.sin((harmonic + 1) * phase);
      });
      samples[index] += 0.5 * toneEnvelope(tone, time) * value;
    }
  }
  const pitch = Float32Array.from(
    { length: Math.floor(seconds / hopSeconds) },
    (_, frame) => {
      const time = frame * hopSeconds;
      const tone = tones.find(
        (item) => toneEnvelope(item, time) >= voicedShare,
      );
      return tone ? toneFrequency(tone, time) : 0;
    },
  );
  return analyzeVocalVoice({
    samples,
    sampleRate,
    line: {
      hopSeconds,
      firstFrame: 0,
      values: pitch,
      confidence: new Float32Array(pitch.length).fill(1),
    },
    pause: async () => Promise.resolve(),
    songSample: (sample) => sample,
  });
};

export const melody = (
  start: number,
  frequencies: readonly number[],
  noteSeconds = 0.4,
  gapSeconds = 0.06,
): ToneSpec[] =>
  frequencies.map((frequency, index) => ({
    start: start + index * (noteSeconds + gapSeconds),
    duration: noteSeconds,
    frequency,
  }));

export type ToneShift = {
  cents?: number;
  seconds?: number;
};

export const shifted = (
  tones: readonly ToneSpec[],
  change: ToneShift,
): ToneSpec[] =>
  tones.map((tone) => ({
    ...tone,
    start: tone.start + (change.seconds ?? 0),
    frequency: tone.frequency * 2 ** ((change.cents ?? 0) / 1200),
  }));
