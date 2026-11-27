import { pageEndFrame } from '../player/pageLayout.cross.js';
import {
  type PlayerStemLayout,
  type PlayerWindow,
} from '../player/protocol.cross.js';
import { type StemPageSamples } from './stemPages.cross.js';

export type FrameSpan = {
  from: number;
  to: number;
};

export type TrackPage = Omit<StemPageSamples, 'id'>;

export type TrackReads = {
  track: number;
  layout: PlayerStemLayout;
  heard: FrameSpan;
  songStartFrame: number;
  tempo: number;
  read: (index: number, signal: AbortSignal) => Promise<TrackPage>;
  readMean:
    ((index: number, signal: AbortSignal) => Promise<TrackPage>) | undefined;
  setWanted: (indices: number[]) => void;
  wanted: number[];
  resident: Set<number>;
  reading: Map<number, AbortController>;
  meanOnly: Set<number>;
  asked: Set<number>;
  means: Map<number, Float32Array<ArrayBuffer>>;
  failed: boolean;
};

export const createTrackReads = (
  track: number,
  layout: PlayerStemLayout,
  read: TrackReads['read'],
  readMean?: TrackReads['readMean'],
): TrackReads => ({
  track,
  layout,
  heard: { from: -Infinity, to: Infinity },
  songStartFrame: 0,
  tempo: 1,
  read,
  readMean,
  setWanted: () => undefined,
  wanted: [],
  resident: new Set(),
  reading: new Map(),
  meanOnly: new Set(),
  asked: new Set(),
  means: new Map(),
  failed: false,
});

export const abortReads = (state: TrackReads) => {
  for (const controller of state.reading.values()) {
    controller.abort();
  }
  state.reading.clear();
  state.meanOnly.clear();
};

const trackFrame = (state: TrackReads, songFrame: number) =>
  (songFrame - state.songStartFrame) / state.tempo;

export const pagesOf = (state: TrackReads, spans: FrameSpan[]): number[] => {
  const { layout, heard } = state;
  const found = new Set<number>();
  for (const span of spans) {
    const from = Math.max(
      0,
      Math.floor(trackFrame(state, Math.max(span.from, heard.from))),
    );
    const to = Math.min(
      layout.frameCount,
      Math.ceil(trackFrame(state, Math.min(span.to, heard.to))),
    );
    for (let index = 0; index < layout.pageStarts.length; index += 1) {
      if (layout.pageStarts[index] < to && pageEndFrame(layout, index) > from) {
        found.add(index);
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
  const frameIndex = trackFrame(state, window.frameIndex);
  const loop = window.loop && {
    fromFrame: trackFrame(state, window.loop.fromFrame),
    toFrame: trackFrame(state, window.loop.toFrame),
  };
  const start = state.layout.pageStarts[index];
  const end = pageEndFrame(state.layout, index);
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
