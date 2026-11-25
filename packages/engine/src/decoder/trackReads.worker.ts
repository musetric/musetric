import { pageEndFrame } from '../player/pageLayout.cross.js';
import {
  type PlayerPageKey,
  type PlayerStemLayout,
  type PlayerWindow,
} from '../player/protocol.cross.js';

export type FrameSpan = {
  from: number;
  to: number;
};

export type TrackReads = {
  track: number;
  layout: PlayerStemLayout;
  songStartFrame: number;
  tempo: number;
  heard: FrameSpan[];
  wanted: number[];
  resident: Set<number>;
  reading: Map<number, AbortController>;
};

const toTrackFrame = (state: TrackReads, songFrame: number) =>
  (songFrame - state.songStartFrame) / state.tempo;

const toTrackSpan = (
  state: TrackReads,
  span: FrameSpan,
  heard: FrameSpan,
): FrameSpan => ({
  from: Math.max(
    0,
    Math.floor(toTrackFrame(state, Math.max(span.from, heard.from))),
  ),
  to: Math.min(
    state.layout.frameCount,
    Math.ceil(toTrackFrame(state, Math.min(span.to, heard.to))),
  ),
});

const addPagesOver = (
  layout: PlayerStemLayout,
  span: FrameSpan,
  found: Set<number>,
) => {
  for (let index = 0; index < layout.pageStarts.length; index += 1) {
    if (
      layout.pageStarts[index] < span.to &&
      pageEndFrame(layout, index) > span.from
    ) {
      found.add(index);
    }
  }
};

export const pagesOf = (state: TrackReads, spans: FrameSpan[]): number[] => {
  const found = new Set<number>();
  for (const span of spans) {
    for (const heard of state.heard) {
      const over = toTrackSpan(state, span, heard);
      if (over.from < over.to) {
        addPagesOver(state.layout, over, found);
      }
    }
  }
  return [...found];
};

const playDistance = (
  state: TrackReads,
  index: number,
  window: PlayerWindow,
): number => {
  const { layout } = state;
  const frameIndex = toTrackFrame(state, window.frameIndex);
  const loop = window.loop && {
    fromFrame: toTrackFrame(state, window.loop.fromFrame),
    toFrame: toTrackFrame(state, window.loop.toFrame),
  };
  const start = layout.pageStarts[index];
  const end = pageEndFrame(layout, index);
  const near = Math.max(0, start - frameIndex, frameIndex + 1 - end);
  if (!loop || frameIndex >= loop.toFrame || end <= loop.fromFrame) {
    return near;
  }
  return Math.min(
    near,
    loop.toFrame - frameIndex + Math.max(0, start - loop.fromFrame),
  );
};

export const byPlayDistance =
  (state: TrackReads, window: PlayerWindow) => (left: number, right: number) =>
    playDistance(state, left, window) - playDistance(state, right, window) ||
    left - right;

export type TrackWindow = {
  window: PlayerWindow;
  wantSpans: FrameSpan[];
  keepSpans: FrameSpan[];
};

export const placeWindow = (
  state: TrackReads,
  placed: TrackWindow,
  dropped: PlayerPageKey[],
) => {
  const keep = new Set(pagesOf(state, placed.keepSpans));
  for (const index of state.resident) {
    if (!keep.has(index)) {
      state.resident.delete(index);
      dropped.push({ track: state.track, index });
    }
  }
  state.wanted = pagesOf(state, placed.wantSpans).sort(
    byPlayDistance(state, placed.window),
  );
};

export const abortReads = (state: TrackReads) => {
  for (const controller of state.reading.values()) {
    controller.abort();
  }
  state.reading.clear();
};

export const abortUnwanted = (state: TrackReads, kept: ReadonlySet<number>) => {
  for (const [index, controller] of state.reading) {
    if (!state.wanted.includes(index) && !kept.has(index)) {
      controller.abort();
      state.reading.delete(index);
    }
  }
};
