import { stemTypes } from '@musetric/audio/es';
import {
  type PlayerPage,
  type PlayerTakes,
  type PlayerTakeTrack,
} from '../player/protocol.cross.js';
import { toRecordingSegments } from '../player/recordingPieces.cross.js';
import { takePageFrameCount } from './takePages.worker.js';
import {
  abortReads,
  abortUnwanted,
  type FrameSpan,
  type TrackReads,
} from './trackReads.worker.js';

const stretchLeadSeconds = 0.5;

export type TakeSource = Omit<PlayerTakeTrack, 'track' | 'sounding'> & {
  key: string;
  read: (
    index: number,
    signal: AbortSignal,
  ) => Promise<Float32Array<ArrayBuffer>>;
};

type TakeReads = TrackReads & {
  source: TakeSource;
  failed: boolean;
};

const createTakeReads = (source: TakeSource, track: number): TakeReads => ({
  track,
  layout: { frameCount: source.frameCount, pageStarts: source.pageStarts },
  songStartFrame: source.songStartFrame,
  tempo: source.tempo,
  heard: [],
  wanted: [],
  resident: new Set(),
  reading: new Map(),
  source,
  failed: false,
});

const toTakeTrack = (state: TakeReads, sounding: boolean): PlayerTakeTrack => ({
  track: state.track,
  songStartFrame: state.source.songStartFrame,
  tempo: state.source.tempo,
  transpose: state.source.transpose,
  octave: state.source.octave,
  frameCount: state.source.frameCount,
  pageStarts: state.source.pageStarts,
  sounding,
});

const heardSpans = (
  layered: readonly TakeReads[],
  leadFrameCount: number,
): Map<TakeReads, FrameSpan[]> => {
  const heard = new Map<TakeReads, FrameSpan[]>();
  const segments = toRecordingSegments(
    layered.map((state) => ({
      songStartFrame: state.songStartFrame,
      tempo: state.tempo,
      frameCount: state.layout.frameCount,
      state,
    })),
  );
  for (const segment of segments) {
    const spans = heard.get(segment.piece.state) ?? [];
    spans.push({
      from: segment.songStartFrame - leadFrameCount,
      to: segment.songEndFrame,
    });
    heard.set(segment.piece.state, spans);
  }
  return heard;
};

const allocate = (used: Set<number>): number => {
  let track = stemTypes.length;
  while (used.has(track)) {
    track += 1;
  }
  used.add(track);
  return track;
};

const waits = (state: TakeReads) =>
  !state.failed && state.wanted.some((index) => !state.resident.has(index));

export type TakeTracksOptions = {
  sources: TakeSource[];
  sampleRate: number;
  windowFrameCount: number;
  putPage: (page: PlayerPage) => void;
  setTakes: (takes: Omit<PlayerTakes, 'residentPageLimit'>) => void;
  retarget: () => void;
  failed: (error: unknown) => void;
};

export type TakeTracks = {
  held: () => TrackReads[];
  takes: () => PlayerTakeTrack[];
  pageLimit: () => number;
  set: (sources: readonly TakeSource[]) => void;
  pump: () => void;
  forget: () => void;
  close: () => void;
};

export const createTakeTracks = (options: TakeTracksOptions): TakeTracks => {
  const { sampleRate } = options;
  const leadFrameCount = stretchLeadSeconds * sampleRate;
  const tracks = new Map<number, TakeReads>();
  let sounding: TakeReads[] = [];
  let incoming: TakeReads[] | undefined = undefined;

  const held = (): TakeReads[] => [
    ...sounding,
    ...(incoming ?? []).filter((state) => !sounding.includes(state)),
  ];

  const hear = () => {
    const now = heardSpans(sounding, leadFrameCount);
    const next = heardSpans(incoming ?? [], leadFrameCount);
    for (const state of held()) {
      state.heard = [...(now.get(state) ?? []), ...(next.get(state) ?? [])];
    }
  };

  const release = () => {
    const kept = held();
    for (const [track, state] of tracks) {
      if (!kept.includes(state)) {
        abortReads(state);
        tracks.delete(track);
      }
    }
  };

  const takes = () =>
    held().map((state) => toTakeTrack(state, sounding.includes(state)));

  const lay = () => {
    release();
    hear();
    options.setTakes({ takes: takes() });
    options.retarget();
  };

  const settle = () => {
    if (
      !incoming ||
      incoming.some((state) => !sounding.includes(state) && waits(state))
    ) {
      return;
    }
    sounding = incoming;
    incoming = undefined;
    lay();
  };

  const deliver = (
    state: TakeReads,
    index: number,
    samples: Float32Array<ArrayBuffer>,
  ) => {
    state.failed = false;
    if (state.wanted.includes(index) && !state.resident.has(index)) {
      state.resident.add(index);
      options.putPage({
        track: state.track,
        index,
        frameCount: samples.length,
        channelCount: 1,
        samples,
      });
    }
  };

  const read = (state: TakeReads, index: number) => {
    const controller = new AbortController();
    state.reading.set(index, controller);
    state.source
      .read(index, controller.signal)
      .then((samples) => {
        if (state.reading.get(index) !== controller) {
          return;
        }
        state.reading.delete(index);
        deliver(state, index, samples);
        settle();
      })
      .catch((error: unknown) => {
        if (state.reading.get(index) !== controller) {
          return;
        }
        state.reading.delete(index);
        state.failed = true;
        options.failed(error);
        settle();
      });
  };

  const place = (sources: readonly TakeSource[]): TakeReads[] => {
    const known = new Map(
      [...tracks.values()].map((state) => [state.source.key, state]),
    );
    const used = new Set(tracks.keys());
    return sources.map((source) => {
      const state =
        known.get(source.key) ?? createTakeReads(source, allocate(used));
      tracks.set(state.track, state);
      return state;
    });
  };

  sounding = place(options.sources);
  hear();

  return {
    held,
    takes,
    pageLimit: () => {
      const states = held();
      if (states.length === 0) {
        return 0;
      }
      const slowest = Math.min(...states.map((state) => state.tempo));
      const pageCount = states.reduce(
        (sum, state) => sum + state.layout.pageStarts.length,
        0,
      );
      const windowPages = Math.ceil(
        (options.windowFrameCount + leadFrameCount) /
          (slowest * takePageFrameCount(sampleRate)),
      );
      return Math.min(pageCount, windowPages + 2 * states.length);
    },
    set: (sources) => {
      incoming = place(sources);
      lay();
    },
    pump: () => {
      for (const state of held()) {
        abortUnwanted(state, new Set());
        for (const index of state.wanted) {
          if (!state.resident.has(index) && !state.reading.has(index)) {
            read(state, index);
          }
        }
      }
      settle();
    },
    forget: () => {
      if (incoming) {
        sounding = incoming;
        incoming = undefined;
      }
      release();
      hear();
      for (const state of sounding) {
        state.resident.clear();
      }
    },
    close: () => {
      for (const state of tracks.values()) {
        abortReads(state);
      }
    },
  };
};
