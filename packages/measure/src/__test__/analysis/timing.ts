import { findClicks } from '../dsp/clicks.js';
import { getMedian, getSpread, type Spread } from '../dsp/stats.js';
import { type TimingRun } from '../runs.js';

const matchShare = 0.25;

export type ClickErrors = Spread & {
  errors: number[];
};

const getClickErrors = (errors: number[]): ClickErrors => ({
  ...getSpread(errors),
  errors,
});

const findLastAtOrBefore = <Item>(
  items: readonly Item[],
  value: number,
  read: (item: Item) => number,
) => {
  let low = 0;
  let high = items.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (read(items[middle]) <= value) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
};

const getCaptureEpoch = (captured: TimingRun['captured'], index: number) => {
  const chunk = findLastAtOrBefore(captured.chunks, index, (item) => item[0]);
  const [offset, epochMs] = captured.chunks[Math.max(0, chunk)];
  return epochMs + ((index - offset) / captured.sampleRate) * 1000;
};

const getShownFrame = (playhead: TimingRun['playhead'], epochMs: number) => {
  const index = findLastAtOrBefore(playhead, epochMs, (item) => item[0]);
  if (index < 0 || !playhead[index][2]) {
    return undefined;
  }
  const [time, frame] = playhead[index];
  const next = playhead.at(index + 1);
  if (!next?.[2]) {
    return frame;
  }
  return frame + ((next[1] - frame) * (epochMs - time)) / (next[0] - time);
};

const findNearestBeat = (beatFrames: readonly number[], frame: number) => {
  const index = findLastAtOrBefore(beatFrames, frame, (beat) => beat);
  const before = beatFrames.at(Math.max(0, index)) ?? frame;
  const after = beatFrames.at(index + 1) ?? before;
  return Math.abs(after - frame) < Math.abs(frame - before) ? after : before;
};

const getBeatSpacing = (beatFrames: readonly number[]) =>
  getMedian(beatFrames.slice(1).map((beat, index) => beat - beatFrames[index]));

const matchBeats = (
  frames: readonly number[],
  beatFrames: readonly number[],
  framesPerMs: number,
) => {
  const tolerance = (matchShare * getBeatSpacing(beatFrames)) / framesPerMs;
  return frames
    .map((frame) => (frame - findNearestBeat(beatFrames, frame)) / framesPerMs)
    .filter((error) => Math.abs(error) < tolerance);
};

export type TimingResult = {
  tempo: number;
  heardClickCount: number;
  playhead: ClickErrors;
  take: ClickErrors;
};

export const analyzeTiming = (run: TimingRun): TimingResult => {
  const heard = findClicks(run.captured.samples, run.captured.sampleRate).map(
    (index) => getCaptureEpoch(run.captured, index),
  );
  const shown = heard.flatMap((epochMs) => {
    const frame = getShownFrame(run.playhead, epochMs);
    return frame === undefined ? [] : [frame];
  });
  const takeFrames = findClicks(run.take.samples, run.sampleRate).map(
    (index) => run.take.firstFrame + index,
  );
  return {
    tempo: run.tempo,
    heardClickCount: heard.length,
    playhead: getClickErrors(
      matchBeats(shown, run.beatFrames, (run.sampleRate * run.tempo) / 1000),
    ),
    take: getClickErrors(
      matchBeats(takeFrames, run.beatFrames, run.sampleRate / 1000),
    ),
  };
};
