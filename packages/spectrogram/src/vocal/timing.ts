import { type VocalFrames } from './frames.js';
import { framesOf } from './math.js';
import { type VocalPhrase } from './segments.js';
import { type VocalVoice } from './voice.js';

const riseSeconds = 0.04;
const riseDb = 8;
const slopeFrames = 2;
const minGapSeconds = 0.1;
const leadInSeconds = 0.05;
const matchSeconds = 0.15;

const steepestFrame = (frames: VocalFrames, from: number, to: number) => {
  let best = from;
  let bestSlope = Number.NEGATIVE_INFINITY;
  for (let index = Math.max(from, slopeFrames); index <= to; index += 1) {
    const slope = frames.body[index] - frames.body[index - slopeFrames];
    if (slope > bestSlope) {
      best = index;
      bestSlope = slope;
    }
  }
  return best;
};

export const findVowelOnsets = (
  frames: VocalFrames,
  phrase: VocalPhrase,
): number[] => {
  const window = framesOf(frames.hopSeconds, riseSeconds);
  const gap = framesOf(frames.hopSeconds, minGapSeconds);
  const onsets: number[] = [];
  const from = Math.max(
    window,
    phrase.start - framesOf(frames.hopSeconds, leadInSeconds),
  );
  for (let index = from; index < phrase.end; index += 1) {
    if (frames.pitch[index] <= 0) {
      continue;
    }
    let low = frames.body[index];
    for (let back = index - window; back < index; back += 1) {
      low = Math.min(low, frames.body[back]);
    }
    const last = onsets.at(-1) ?? Number.NEGATIVE_INFINITY;
    if (frames.body[index] - low >= riseDb && index - last >= gap) {
      onsets.push(steepestFrame(frames, index - window, index));
      index += gap;
    }
  }
  return onsets;
};

const findNearest = (times: readonly number[], time: number) => {
  let best: number | undefined = undefined;
  let bestDistance = matchSeconds;
  for (const other of times) {
    const distance = Math.abs(other - time);
    if (distance <= bestDistance) {
      best = other;
      bestDistance = distance;
    }
  }
  return best;
};

export type VowelOnsetPair = {
  phrase: VocalPhrase;
  lead: number;
  take: number;
};

export const pairVowelOnsets = (
  lead: VocalVoice,
  take: VocalVoice,
): VowelOnsetPair[] => {
  const takeOnsets = take.phrases.flatMap((phrase) =>
    findVowelOnsets(take.frames, phrase).map(take.songSeconds),
  );
  return lead.phrases.flatMap((phrase) =>
    findVowelOnsets(lead.frames, phrase).flatMap((frame) => {
      const time = lead.songSeconds(frame);
      const other = findNearest(takeOnsets, time);
      return other === undefined ? [] : [{ phrase, lead: time, take: other }];
    }),
  );
};
