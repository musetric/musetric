import { type VocalFrames } from './frames.js';
import { median } from './math.js';
import { pairVowelOnsets } from './timing.js';
import { type VocalVoice } from './voice.js';

const pairMarginSeconds = 1;
const sourceMarginSeconds = 0.1;
const peakSearchShare = 0.25;
const maxLevelShiftDb = 12;
const minWindowWeight = 0.1;

type Warp = (time: number) => number;

const identityWarp: Warp = (time) => time;

const createTimingWarp = (
  lead: VocalVoice,
  take: VocalVoice,
  start: number,
  end: number,
): Warp => {
  const pairs = pairVowelOnsets(lead, take)
    .filter(
      (pair) =>
        pair.lead >= start - pairMarginSeconds &&
        pair.lead <= end + pairMarginSeconds,
    )
    .toSorted((left, right) => left.lead - right.lead);
  const first = pairs.at(0);
  const last = pairs.at(-1);
  if (!first || !last) {
    return identityWarp;
  }
  return (time) => {
    if (time <= first.lead) {
      return time + first.take - first.lead;
    }
    if (time >= last.lead) {
      return time + last.take - last.lead;
    }
    const next = pairs.findIndex((pair) => pair.lead > time);
    const before = pairs[next - 1];
    const after = pairs[next];
    const share = (time - before.lead) / (after.lead - before.lead);
    return before.take + share * (after.take - before.take);
  };
};

const frameValue = (
  frames: VocalFrames,
  values: Float32Array,
  sample: number,
) => {
  const hop = frames.hopSeconds * frames.sampleRate;
  return values[Math.round(sample / hop) - frames.firstFrame] ?? 0;
};

type PitchMark = {
  position: number;
  period: number;
  voiced: boolean;
};

const findPitchMarks = (
  frames: VocalFrames,
  samples: Float32Array,
  from: number,
  to: number,
): PitchMark[] => {
  const hop = Math.round(frames.hopSeconds * frames.sampleRate);
  const marks: PitchMark[] = [];
  let position = Math.max(0, from);
  while (position < to) {
    const fundamental = frameValue(frames, frames.pitch, position);
    if (fundamental <= 0) {
      marks.push({ position, period: hop, voiced: false });
      position += hop;
      continue;
    }
    const period = frames.sampleRate / fundamental;
    const reach = Math.round(period * peakSearchShare);
    let peak = position;
    for (let index = position - reach; index <= position + reach; index += 1) {
      if (Math.abs(samples[index] ?? 0) > Math.abs(samples[peak] ?? 0)) {
        peak = index;
      }
    }
    marks.push({ position: peak, period, voiced: true });
    position = Math.round(peak + period);
  }
  return marks;
};

const nearestMark = (marks: readonly PitchMark[], position: number) => {
  let low = 0;
  let high = marks.length - 1;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (marks[middle].position <= position) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return Math.abs(marks[high].position - position) <
    Math.abs(marks[low].position - position)
    ? marks[high]
    : marks[low];
};

const regionMedian = (
  frames: VocalFrames,
  from: number,
  to: number,
): number => {
  const hop = frames.hopSeconds * frames.sampleRate;
  const voiced: number[] = [];
  const all: number[] = [];
  for (let sample = from; sample < to; sample += hop) {
    const level = frameValue(frames, frames.body, sample);
    all.push(level);
    if (frameValue(frames, frames.pitch, sample) > 0) {
      voiced.push(level);
    }
  }
  return median(voiced.length > 0 ? voiced : all);
};

const foldedTarget = (lead: number, take: number) =>
  lead * 2 ** Math.round(Math.log2(take / lead));

type GrainInput = {
  samples: Float32Array;
  mark: PitchMark;
  center: number;
  gain: number;
  output: Float32Array;
  weights: Float32Array;
};

const addGrain = (input: GrainInput) => {
  const { samples, mark, center, gain, output, weights } = input;
  const half = Math.round(mark.period);
  for (let offset = -half; offset <= half; offset += 1) {
    const target = center + offset;
    if (target < 0 || target >= output.length) {
      continue;
    }
    const window = 0.5 + 0.5 * Math.cos((Math.PI * offset) / half);
    output[target] += (samples[mark.position + offset] ?? 0) * window * gain;
    weights[target] += window;
  }
};

export type TakeVersion = 'pitch' | 'timing' | 'level' | 'all';

export type RenderTakeVersionInput = {
  lead: VocalVoice;
  take: VocalVoice;
  takeSamples: Float32Array;
  rawPosition: (songSample: number) => number;
  start: number;
  end: number;
  version: TakeVersion;
};

export const renderTakeVersion = (input: RenderTakeVersionInput) => {
  const { lead, take, takeSamples, rawPosition, start, end, version } = input;
  const { sampleRate } = take.frames;
  const correctPitch = version === 'pitch' || version === 'all';
  const correctTiming = version === 'timing' || version === 'all';
  const correctLevel = version === 'level' || version === 'all';
  const warp = correctTiming
    ? createTimingWarp(lead, take, start, end)
    : identityWarp;
  const rawStart = rawPosition(warp(start) * sampleRate);
  const rawEnd = rawPosition(warp(end) * sampleRate);
  const margin = Math.round(sourceMarginSeconds * sampleRate);
  const marks = findPitchMarks(
    take.frames,
    takeSamples,
    Math.round(Math.min(rawStart, rawEnd)) - margin,
    Math.round(Math.max(rawStart, rawEnd)) + margin,
  );
  const leadUsual = regionMedian(
    lead.frames,
    start * sampleRate,
    end * sampleRate,
  );
  const takeUsual = regionMedian(
    take.frames,
    Math.min(rawStart, rawEnd),
    Math.max(rawStart, rawEnd),
  );
  const length = Math.round((end - start) * sampleRate);
  const output = new Float32Array(length);
  const weights = new Float32Array(length);
  let center = 0;
  while (center < length && marks.length > 0) {
    const songSample = (start + center / sampleRate) * sampleRate;
    const raw = rawPosition(warp(songSample / sampleRate) * sampleRate);
    const mark = nearestMark(marks, raw);
    const leadPitch = frameValue(lead.frames, lead.frames.pitch, songSample);
    const takePitch = sampleRate / mark.period;
    const ratio =
      correctPitch && mark.voiced && leadPitch > 0
        ? foldedTarget(leadPitch, takePitch) / takePitch
        : 1;
    const shift = correctLevel
      ? Math.max(
          -maxLevelShiftDb,
          Math.min(
            maxLevelShiftDb,
            frameValue(lead.frames, lead.frames.body, songSample) -
              leadUsual -
              (frameValue(take.frames, take.frames.body, mark.position) -
                takeUsual),
          ),
        )
      : 0;
    addGrain({
      samples: takeSamples,
      mark,
      center,
      gain: 10 ** (shift / 20),
      output,
      weights,
    });
    center += Math.max(1, Math.round(mark.period / ratio));
  }
  for (let index = 0; index < length; index += 1) {
    output[index] /= Math.max(minWindowWeight, weights[index]);
  }
  return output;
};
