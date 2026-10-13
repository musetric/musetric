import { type api } from '@musetric/api';
import {
  type EngineRange,
  type EngineRangePlay,
  type EngineState,
} from '@musetric/engine';
import {
  getSubtitleActiveSegmentIndex,
  getSubtitleSegmentEndTime,
} from '../subtitle/subtitleTiming.js';

const edgeSeconds = 0.5;
const edgePreviewSeconds = 1;
const fallbackSeconds = 8;
const fallbackBars = 4;
export const minLoopSeconds = 1;

const getFirstWordStart = (segment: api.subtitle.Segment) =>
  segment.words.at(0)?.start ?? segment.start;

export type LoopTiming = Pick<
  EngineState,
  'duration' | 'metronomeDownbeats'
> & {
  sampleRate: number;
};

type LoopTimes = {
  from: number;
  to: number;
};

const toLoopRange = (times: LoopTimes, timing: LoopTiming): EngineRange => {
  const { sampleRate } = timing;
  const to = Math.min(
    timing.duration,
    Math.max(times.to, times.from + minLoopSeconds),
  );
  return {
    fromFrame: Math.round(times.from * sampleRate),
    toFrame: Math.round(to * sampleRate),
  };
};

const getLineTimes = (
  subtitle: readonly api.subtitle.Segment[],
  index: number,
  duration: number,
): LoopTimes => {
  const segment = subtitle[index];
  const first = getFirstWordStart(segment);
  const last = getSubtitleSegmentEndTime(segment);
  const previous = subtitle.at(index - 1);
  const next = subtitle.at(index + 1);
  const previousEnd =
    index > 0 && previous ? getSubtitleSegmentEndTime(previous) : 0;
  const nextStart = next ? getFirstWordStart(next) : duration;
  return {
    from: Math.min(
      first,
      Math.max(0, first - edgeSeconds, (previousEnd + first) / 2),
    ),
    to: Math.max(
      last,
      Math.min(duration, last + edgeSeconds, (last + nextStart) / 2),
    ),
  };
};

const getBarTimes = (time: number, timing: LoopTiming): LoopTimes => {
  const downbeats = timing.metronomeDownbeats;
  const firstBar = downbeats.findLastIndex((downbeat) => downbeat <= time);
  const lastBar = downbeats.at(firstBar + fallbackBars);
  if (firstBar < 0 || lastBar === undefined) {
    return { from: time, to: time + fallbackSeconds };
  }
  return { from: downbeats[firstBar], to: lastBar };
};

export const getLoopAtTime = (
  subtitle: readonly api.subtitle.Segment[],
  time: number,
  timing: LoopTiming,
): EngineRange => {
  const index = getSubtitleActiveSegmentIndex(subtitle, time);
  const times =
    index < subtitle.length
      ? getLineTimes(subtitle, index, timing.duration)
      : getBarTimes(time, timing);
  return toLoopRange(times, timing);
};

export type SubtitleWordRef = {
  segmentIndex: number;
  wordIndex: number;
};

export const isSameWord = (a: SubtitleWordRef, b: SubtitleWordRef) =>
  a.segmentIndex === b.segmentIndex && a.wordIndex === b.wordIndex;

const isWordBefore = (a: SubtitleWordRef, b: SubtitleWordRef) =>
  a.segmentIndex < b.segmentIndex ||
  (a.segmentIndex === b.segmentIndex && a.wordIndex < b.wordIndex);

const getWord = (
  subtitle: readonly api.subtitle.Segment[],
  ref: SubtitleWordRef,
): api.subtitle.Word => subtitle[ref.segmentIndex].words[ref.wordIndex];

const getPreviousWordEnd = (
  subtitle: readonly api.subtitle.Segment[],
  ref: SubtitleWordRef,
): number => {
  if (ref.wordIndex > 0) {
    return subtitle[ref.segmentIndex].words[ref.wordIndex - 1].end;
  }
  const previous = subtitle
    .slice(0, ref.segmentIndex)
    .findLast((segment) => segment.words.length > 0);
  return previous?.words.at(-1)?.end ?? 0;
};

const getNextWordStart = (
  subtitle: readonly api.subtitle.Segment[],
  ref: SubtitleWordRef,
  duration: number,
): number => {
  const { words } = subtitle[ref.segmentIndex];
  if (ref.wordIndex < words.length - 1) {
    return words[ref.wordIndex + 1].start;
  }
  const next = subtitle
    .slice(ref.segmentIndex + 1)
    .find((segment) => segment.words.length > 0);
  return next?.words[0].start ?? duration;
};

export const getLoopForWords = (
  subtitle: readonly api.subtitle.Segment[],
  anchor: SubtitleWordRef,
  current: SubtitleWordRef,
  timing: LoopTiming,
): EngineRange => {
  const [first, last] = isWordBefore(current, anchor)
    ? [current, anchor]
    : [anchor, current];
  const { start } = getWord(subtitle, first);
  const { end } = getWord(subtitle, last);
  const previousEnd = getPreviousWordEnd(subtitle, first);
  const nextStart = getNextWordStart(subtitle, last, timing.duration);
  return toLoopRange(
    {
      from: Math.min(
        start,
        Math.max(0, start - edgeSeconds, (previousEnd + start) / 2),
      ),
      to: Math.max(
        end,
        Math.min(timing.duration, end + edgeSeconds, (end + nextStart) / 2),
      ),
    },
    timing,
  );
};

export type LoopEdge = 'from' | 'to';

export const getLoopEdgePreview = (
  range: EngineRange,
  edge: LoopEdge,
  sampleRate: number,
): EngineRangePlay => {
  const frames = edgePreviewSeconds * sampleRate;
  return edge === 'to'
    ? {
        startFrame: Math.round(
          Math.max(range.fromFrame, range.toFrame - frames),
        ),
      }
    : {
        stopFrame: Math.round(
          Math.min(range.toFrame, range.fromFrame + frames),
        ),
      };
};

export const formatLoopTime = (seconds: number): string => {
  const tenths = Math.max(0, Math.round(seconds * 10));
  const minutes = Math.floor(tenths / 600);
  const rest = (tenths - minutes * 600) / 10;
  return `${minutes}:${rest.toFixed(1).padStart(4, '0')}`;
};
