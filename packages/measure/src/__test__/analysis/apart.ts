import { type CursorRun } from '../runs.js';

const settleMs = 700;
const leadMs = 100;
const writeGapMs = 100;

const phaseEnd = (run: CursorRun, index: number) => {
  const [time, kind] = run.events[index];
  return kind === 'dragStart' || kind === 'loopStart'
    ? (run.events.at(index + 1)?.[0] ?? Number.POSITIVE_INFINITY)
    : time;
};

const isSettled = (run: CursorRun, time: number) =>
  run.events.every(
    (event, index) =>
      time < event[0] - leadMs || time > phaseEnd(run, index) + settleMs,
  );

const pageFrameAt = (writes: CursorRun['writes'], time: number) => {
  let low = 0;
  let high = writes.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (writes[middle][0] <= time) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  const before = writes.at(low);
  const after = writes.at(low + 1);
  if (
    !before ||
    !after ||
    before[0] > time ||
    after[1] < before[1] ||
    after[0] - before[0] > writeGapMs
  ) {
    return undefined;
  }
  return (
    before[1] +
    ((after[1] - before[1]) * (time - before[0])) / (after[0] - before[0])
  );
};

export type ApartResult = {
  count: number;
  medianMs: number;
  largestMs: number;
};

export const checkApart = (run: CursorRun): ApartResult => {
  const apart: number[] = [];
  for (const [time, frame, playing] of run.drawn) {
    if (playing !== 1 || !isSettled(run, time)) {
      continue;
    }
    const page = pageFrameAt(run.writes, time);
    if (page !== undefined) {
      apart.push((Math.abs(frame - page) / run.sampleRate) * 1000);
    }
  }
  const sorted = apart.toSorted((left, right) => left - right);
  return {
    count: sorted.length,
    medianMs: sorted.at(Math.floor(sorted.length / 2)) ?? 0,
    largestMs: sorted.at(-1) ?? 0,
  };
};
