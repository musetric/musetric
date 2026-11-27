import {
  createMappedSource,
  type SpectrogramSource,
} from '@musetric/spectrogram';
import { toRecordingSegments } from '../player/recordingPieces.cross.js';
import {
  type SpectrogramTake,
  type SpectrogramTakes,
} from './protocol.cross.js';
import { createTrackPages, type TrackPages } from './trackPages.worker.js';
import { type ViewSpan } from './viewWindow.worker.js';

export type SongRange = {
  frameIndex: number;
  frameCount: number;
};

const toSongRange = (
  take: SpectrogramTake,
  offset: number,
  frameCount: number,
): SongRange => ({
  frameIndex: Math.floor(take.songStartFrame + offset * take.tempo),
  frameCount: Math.ceil(frameCount * take.tempo) + 1,
});

export type LiveTakePreview = {
  songFrame: number;
  samples: Float32Array;
};

export type TakePagesRequest = {
  key: string;
  indices: number[];
};

export type RecordingSource = {
  setTakes: (takes: SpectrogramTakes) => void;
  put: (
    key: string,
    index: number,
    samples: Float32Array,
  ) => SongRange | undefined;
  writeLiveTake: (
    offset: number,
    samples: Float32Array,
  ) => SongRange | undefined;
  previewLiveTake: (preview: LiveTakePreview) => SongRange | undefined;
  liveEnd: () => number | undefined;
  prepare: (span: ViewSpan | undefined) => void;
  get: (songLength: number) => SpectrogramSource | undefined;
  takeWanted: () => TakePagesRequest[];
  sweep: () => void;
  clear: () => void;
};

type LiveTail = {
  key: string;
  written: number;
  previewEnd: number;
};

export const createRecordingSource = (): RecordingSource => {
  const tracks = new Map<string, TrackPages>();
  let drawn: SpectrogramTake[] = [];
  let target: SpectrogramTakes = { takes: [] };
  let changed = false;
  let tail: LiveTail | undefined = undefined;
  let cached:
    { songLength: number; source: SpectrogramSource | undefined } | undefined =
    undefined;

  const keepTracks = () => {
    const kept = new Set([...drawn, ...target.takes].map((take) => take.key));
    for (const key of tracks.keys()) {
      if (!kept.has(key)) {
        tracks.delete(key);
      }
    }
  };

  const findTake = (takes: readonly SpectrogramTake[], key: string) =>
    takes.find((take) => take.key === key);

  const liveTake = () => tail && findTake(target.takes, tail.key);

  const isReady = (span: ViewSpan) => {
    let ready = true;
    for (const segment of toRecordingSegments(target.takes)) {
      const { piece } = segment;
      const from = Math.max(segment.songStartFrame, span.from);
      const to = Math.min(segment.songEndFrame, span.to);
      const pages = tracks.get(piece.key);
      if (!pages || from >= to) {
        continue;
      }
      const end = piece.key === tail?.key ? tail.written : piece.frameCount;
      const missing = pages.missing(
        Math.floor((from - piece.songStartFrame) / piece.tempo),
        Math.min(end, Math.ceil((to - piece.songStartFrame) / piece.tempo)),
      );
      ready &&= !missing;
    }
    return ready;
  };

  const buildSource = (songLength: number): SpectrogramSource =>
    createMappedSource(
      toRecordingSegments(drawn).flatMap((segment) => {
        const pages = tracks.get(segment.piece.key);
        return pages
          ? [
              {
                songStartFrame: segment.songStartFrame,
                songEndFrame: segment.songEndFrame,
                rawStartFrame:
                  (segment.songStartFrame - segment.piece.songStartFrame) /
                  segment.piece.tempo,
                tempo: segment.piece.tempo,
                transpose: segment.piece.transpose + 12 * segment.piece.octave,
                forEachRun: pages.forEachRun,
              },
            ]
          : [];
      }),
      songLength,
    );

  return {
    setTakes: (next) => {
      target = next;
      changed = true;
      if (tail?.key !== next.live) {
        tail =
          next.live === undefined
            ? undefined
            : { key: next.live, written: 0, previewEnd: 0 };
      }
      for (const take of next.takes) {
        const pages = tracks.get(take.key);
        if (pages) {
          pages.relayout(take);
        } else {
          tracks.set(take.key, createTrackPages(take));
        }
      }
      keepTracks();
    },
    put: (key, index, samples) => {
      const range = tracks.get(key)?.put(index, samples);
      const take = findTake(drawn, key);
      return range && take
        ? toSongRange(take, range.frameIndex, range.frameCount)
        : undefined;
    },
    writeLiveTake: (offset, samples) => {
      const take = liveTake();
      const pages = tail && tracks.get(tail.key);
      if (!tail || !take || !pages || offset >= take.frameCount) {
        return undefined;
      }
      tail.written = Math.max(tail.written, pages.write(offset, samples));
      return toSongRange(take, offset, samples.length);
    },
    previewLiveTake: (preview) => {
      const take = liveTake();
      const pages = tail && tracks.get(tail.key);
      if (!tail || !take || !pages) {
        return undefined;
      }
      const { samples } = preview;
      const placed = Math.round(
        (preview.songFrame - take.songStartFrame) / take.tempo,
      );
      const start =
        Math.abs(placed - tail.previewEnd) <= samples.length / 2
          ? tail.previewEnd
          : placed;
      const offset = Math.max(start, tail.written);
      if (offset >= Math.min(take.frameCount, start + samples.length)) {
        return undefined;
      }
      const end = pages.write(offset, samples.subarray(offset - start));
      tail.previewEnd = start + samples.length;
      return toSongRange(take, offset, end - offset);
    },
    liveEnd: () => {
      const take = liveTake();
      if (!tail || !take) {
        return undefined;
      }
      const end = Math.max(tail.written, tail.previewEnd);
      return Math.floor(take.songStartFrame + end * take.tempo);
    },
    prepare: (span) => {
      if (!changed || (span && !isReady(span))) {
        return;
      }
      drawn = target.takes;
      changed = false;
      cached = undefined;
      keepTracks();
    },
    get: (songLength) => {
      if (cached?.songLength === songLength) {
        return cached.source;
      }
      const source = drawn.length > 0 ? buildSource(songLength) : undefined;
      cached = { songLength, source };
      return source;
    },
    takeWanted: () =>
      [...tracks].flatMap((entry) => {
        const [key, pages] = entry;
        const indices = pages.takeWanted();
        return indices.length > 0 ? [{ key, indices }] : [];
      }),
    sweep: () => {
      for (const pages of tracks.values()) {
        pages.sweep();
      }
    },
    clear: () => {
      tracks.clear();
      drawn = [];
      target = { takes: [] };
      changed = false;
      tail = undefined;
      cached = undefined;
    },
  };
};
