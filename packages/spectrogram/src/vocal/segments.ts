import { type VocalFrames } from './frames.js';
import { centsOf, framesOf, median } from './math.js';

const bridgeSeconds = 0.03;
const minRunSeconds = 0.06;
const phraseGapSeconds = 0.25;
const smoothingSeconds = 0.18;
const noteToleranceCents = 45;
const noteBreakSeconds = 0.04;
const minNoteSeconds = 0.08;

export type VocalSpan = {
  start: number;
  end: number;
};

const findRuns = (frames: VocalFrames): VocalSpan[] => {
  const bridge = framesOf(frames.hopSeconds, bridgeSeconds);
  const runs: VocalSpan[] = [];
  let start = -1;
  let lastVoiced = -1;
  frames.pitch.forEach((value, index) => {
    if (value <= 0) {
      return;
    }
    if (start < 0 || index - lastVoiced > bridge + 1) {
      if (start >= 0) {
        runs.push({ start, end: lastVoiced + 1 });
      }
      start = index;
    }
    lastVoiced = index;
  });
  if (start >= 0) {
    runs.push({ start, end: lastVoiced + 1 });
  }
  const minRun = framesOf(frames.hopSeconds, minRunSeconds);
  return runs.filter((run) => run.end - run.start >= minRun);
};

export const voicedCents = (frames: VocalFrames, span: VocalSpan): number[] => {
  const cents: number[] = [];
  for (let index = span.start; index < span.end; index += 1) {
    const value = frames.pitch[index];
    if (value > 0) {
      cents.push(centsOf(value));
    }
  }
  return cents;
};

export const smoothedCents = (
  frames: VocalFrames,
  span: VocalSpan,
): Float32Array => {
  const radius = Math.floor(framesOf(frames.hopSeconds, smoothingSeconds) / 2);
  return Float32Array.from({ length: span.end - span.start }, (_, offset) => {
    const index = span.start + offset;
    const window = voicedCents(frames, {
      start: Math.max(span.start, index - radius),
      end: Math.min(span.end, index + radius + 1),
    });
    return window.reduce((sum, value) => sum + value, 0) / window.length;
  });
};

export type VocalNote = VocalSpan & {
  cents: number;
};

const findNotes = (frames: VocalFrames, run: VocalSpan): VocalNote[] => {
  const smooth = smoothedCents(frames, run);
  const breakFrames = framesOf(frames.hopSeconds, noteBreakSeconds);
  const minNote = framesOf(frames.hopSeconds, minNoteSeconds);
  const notes: VocalNote[] = [];

  const close = (start: number, end: number) => {
    const span = { start: run.start + start, end: run.start + end };
    if (end - start >= minNote) {
      notes.push({ ...span, cents: median(voicedCents(frames, span)) });
    }
  };

  let start = 0;
  let sum = 0;
  let count = 0;
  let outside = 0;
  smooth.forEach((value, offset) => {
    const drifted =
      count > 0 && Math.abs(value - sum / count) > noteToleranceCents;
    outside = drifted ? outside + 1 : 0;
    if (!drifted) {
      sum += value;
      count += 1;
      return;
    }
    if (outside < breakFrames) {
      return;
    }
    const breakAt = offset - outside + 1;
    close(start, breakAt);
    start = breakAt;
    const restart = smooth.subarray(breakAt, offset + 1);
    sum = restart.reduce((total, item) => total + item, 0);
    count = restart.length;
    outside = 0;
  });
  close(start, smooth.length);
  return notes;
};

export type VocalPhrase = VocalSpan & {
  notes: VocalNote[];
};

export const findPhrases = (frames: VocalFrames): VocalPhrase[] => {
  const gap = framesOf(frames.hopSeconds, phraseGapSeconds);
  const phrases: VocalPhrase[] = [];
  for (const run of findRuns(frames)) {
    const last = phrases.at(-1);
    const notes = findNotes(frames, run);
    if (last && run.start - last.end < gap) {
      last.end = run.end;
      last.notes.push(...notes);
      continue;
    }
    phrases.push({ start: run.start, end: run.end, notes });
  }
  return phrases;
};
