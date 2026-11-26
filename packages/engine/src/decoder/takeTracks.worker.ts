import { stemTypes } from '@musetric/audio/es';
import { type PlayerTakeTrack } from '../player/protocol.cross.js';
import { takePageFrameCount } from './takePages.worker.js';
import {
  createTrackReads,
  type TrackPage,
  type TrackReads,
} from './trackReads.worker.js';

const leadSeconds = 0.5;

export type TakeSource = Omit<PlayerTakeTrack, 'track' | 'sounding'> & {
  key: string;
  read: (index: number, signal: AbortSignal) => Promise<TrackPage>;
};

type Take = {
  source: TakeSource;
  state: TrackReads;
};

const openTake = (
  source: TakeSource,
  track: number,
  sampleRate: number,
): Take => ({
  source,
  state: {
    ...createTrackReads(track, source, source.read),
    heard: {
      from: source.songStartFrame - leadSeconds * sampleRate,
      to: source.songStartFrame + source.frameCount * source.tempo,
    },
    songStartFrame: source.songStartFrame,
    tempo: source.tempo,
  },
});

export type TakeTracksOptions = {
  sources: TakeSource[];
  sampleRate: number;
  windowFrameCount: number;
};

export type TakeTracks = {
  held: () => TrackReads[];
  layouts: () => PlayerTakeTrack[];
  pageLimit: () => number;
  set: (sources: TakeSource[]) => TrackReads[];
  waiting: () => TrackReads[] | undefined;
  commit: () => TrackReads[];
};

export const createTakeTracks = (options: TakeTracksOptions): TakeTracks => {
  const { sampleRate } = options;
  let sounding: Take[] = [];
  let incoming: Take[] | undefined = undefined;

  const held = () => [
    ...sounding,
    ...(incoming ?? []).filter((take) => !sounding.includes(take)),
  ];

  const place = (sources: TakeSource[]) => {
    const known = new Map(held().map((take) => [take.source.key, take]));
    const used = new Set(held().map((take) => take.state.track));
    return sources.map((source) => {
      const found = known.get(source.key);
      if (found) {
        return found;
      }
      let track = stemTypes.length;
      while (used.has(track)) {
        track += 1;
      }
      used.add(track);
      return openTake(source, track, sampleRate);
    });
  };

  const change = (next: () => void) => {
    const before = held();
    next();
    const after = held();
    return before
      .filter((take) => !after.includes(take))
      .map((take) => take.state);
  };

  sounding = place(options.sources);

  return {
    held: () => held().map((take) => take.state),
    layouts: () =>
      held().map((take) => ({
        track: take.state.track,
        frameCount: take.source.frameCount,
        pageStarts: take.source.pageStarts,
        songStartFrame: take.source.songStartFrame,
        tempo: take.source.tempo,
        transpose: take.source.transpose,
        octave: take.source.octave,
        sounding: sounding.includes(take),
      })),
    pageLimit: () => {
      const states = held().map((take) => take.state);
      const slowest = Math.min(...states.map((state) => state.tempo));
      const pages = states.reduce(
        (sum, state) => sum + state.layout.pageStarts.length,
        0,
      );
      const window = options.windowFrameCount + leadSeconds * sampleRate;
      return Math.min(
        pages,
        Math.ceil(window / (slowest * takePageFrameCount(sampleRate))) +
          2 * states.length,
      );
    },
    set: (sources) =>
      change(() => {
        incoming = place(sources);
      }),
    waiting: () =>
      incoming
        ?.filter((take) => !sounding.includes(take))
        .map((take) => take.state),
    commit: () =>
      change(() => {
        sounding = incoming ?? sounding;
        incoming = undefined;
      }),
  };
};
