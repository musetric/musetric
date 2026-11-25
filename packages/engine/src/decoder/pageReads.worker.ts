import { type StemType, stemTypes } from '@musetric/audio/es';
import { pageEndFrame } from '../player/pageLayout.cross.js';
import {
  type PlayerPage,
  type PlayerPageKey,
  type PlayerRange,
  type PlayerStemLayout,
  type PlayerTakes,
  type PlayerWindow,
  stemTracks,
} from '../player/protocol.cross.js';
import { type SpectrogramLeadPage } from '../spectrogram/protocol.cross.js';
import { type StemPageReaders } from './stemPageReaders.worker.js';
import { type StemPageSamples } from './stemPages.cross.js';
import {
  createTakeTracks,
  type TakeSource,
  type TakeTracks,
} from './takeTracks.worker.js';
import {
  abortReads,
  abortUnwanted,
  byPlayDistance,
  type FrameSpan,
  placeWindow,
  type TrackReads,
  type TrackWindow,
} from './trackReads.worker.js';

const behindSeconds = 4;
const aheadSeconds = 8;
const keepSeconds = 4;
const loopPinSeconds = 4;
const crossfadeFrameCount = 1488;
const readsPerStem = 2;

const spanPageCount = (layout: PlayerStemLayout, frameCount: number) => {
  let shortest = Infinity;
  for (let index = 0; index + 1 < layout.pageStarts.length; index += 1) {
    shortest = Math.min(
      shortest,
      pageEndFrame(layout, index) - layout.pageStarts[index],
    );
  }
  return shortest === Infinity
    ? layout.pageStarts.length
    : Math.ceil(frameCount / shortest) + 1;
};

const residentPageCount = (layout: PlayerStemLayout, sampleRate: number) =>
  Math.min(
    layout.pageStarts.length,
    spanPageCount(
      layout,
      (behindSeconds + aheadSeconds + 2 * keepSeconds) * sampleRate,
    ) + spanPageCount(layout, aheadSeconds * sampleRate),
  );

const aheadSpans = (
  frameIndex: number,
  frameCount: number,
  loop: PlayerRange | undefined,
): FrameSpan[] => {
  const to = frameIndex + frameCount;
  if (!loop || frameIndex >= loop.toFrame || to <= loop.toFrame) {
    return [{ from: frameIndex, to }];
  }
  return [
    { from: frameIndex, to: loop.toFrame },
    { from: loop.fromFrame, to: loop.fromFrame + (to - loop.toFrame) },
  ];
};

const placeSpans = (
  window: PlayerWindow,
  played: PlayerWindow,
  sampleRate: number,
): TrackWindow => {
  const { frameIndex, loop } = window;
  const wantSpans = [
    { from: frameIndex - behindSeconds * sampleRate, to: frameIndex },
    ...aheadSpans(frameIndex, aheadSeconds * sampleRate, loop),
    ...(loop
      ? [
          {
            from: loop.fromFrame - crossfadeFrameCount,
            to: Math.min(
              loop.toFrame,
              loop.fromFrame + loopPinSeconds * sampleRate,
            ),
          },
        ]
      : []),
  ];
  const keepSpans = [
    ...wantSpans,
    {
      from: frameIndex - (behindSeconds + keepSeconds) * sampleRate,
      to: frameIndex + (aheadSeconds + keepSeconds) * sampleRate,
    },
    ...aheadSpans(played.frameIndex, aheadSeconds * sampleRate, played.loop),
  ];
  return { window, wantSpans, keepSpans };
};

type StemReads = TrackReads & {
  mean: boolean;
  asked: Set<number>;
  means: Map<number, Float32Array<ArrayBuffer>>;
};

const createStemReads = (
  stem: StemType,
  layout: PlayerStemLayout,
): StemReads => ({
  track: stemTracks[stem],
  layout,
  songStartFrame: 0,
  tempo: 1,
  heard: [{ from: -Infinity, to: Infinity }],
  mean: stem === 'lead',
  wanted: [],
  resident: new Set(),
  reading: new Map(),
  asked: new Set(),
  means: new Map(),
});

export type PageReadsOptions = {
  readers: StemPageReaders;
  layouts: Record<StemType, PlayerStemLayout>;
  takes: TakeSource[];
  sampleRate: number;
  putPage: (page: PlayerPage) => void;
  dropPages: (pages: PlayerPageKey[]) => void;
  setTakes: (takes: PlayerTakes) => void;
  putLeadPage: (page: SpectrogramLeadPage) => void;
  failed: (error: unknown) => void;
};

export type PageReads = {
  takes: () => PlayerTakes;
  setTakes: (sources: readonly TakeSource[]) => void;
  requestWindow: (window: PlayerWindow) => void;
  requestTarget: (window: PlayerWindow) => void;
  requestLeadPages: (indices: number[]) => void;
  forgetPlayer: () => void;
  close: () => void;
};

export const createPageReads = (options: PageReadsOptions): PageReads => {
  const { readers, layouts, sampleRate } = options;
  const stems: Record<StemType, StemReads> = {
    lead: createStemReads('lead', layouts.lead),
    backing: createStemReads('backing', layouts.backing),
    instrumental: createStemReads('instrumental', layouts.instrumental),
  };
  const stemLimit = stemTypes.reduce(
    (sum, stem) => sum + residentPageCount(layouts[stem], sampleRate),
    0,
  );
  let window: PlayerWindow = { frameIndex: 0 };
  let played = window;

  const deliver = (stem: StemType, page: StemPageSamples) => {
    const state = stems[stem];
    const { index } = page;
    if (state.wanted.includes(index) && !state.resident.has(index)) {
      state.resident.add(index);
      options.putPage({
        track: state.track,
        index,
        frameCount: page.frameCount,
        channelCount: page.samples.length / page.frameCount,
        samples: page.samples,
      });
    }
    if (!page.mean) {
      return;
    }
    if (state.asked.delete(index)) {
      options.putLeadPage({
        index,
        startFrame: page.startFrame,
        samples: page.mean,
      });
    } else if (state.resident.has(index)) {
      state.means.set(index, page.mean);
    }
  };

  const pump = (stem: StemType) => {
    const state = stems[stem];
    const missing = state.wanted.filter((index) => !state.resident.has(index));
    const queue = [
      ...missing,
      ...[...state.asked].sort(byPlayDistance(state, window)),
    ];
    for (const index of queue) {
      if (
        state.reading.has(index) ||
        (!missing.includes(index) && state.reading.size >= readsPerStem)
      ) {
        continue;
      }
      const controller = new AbortController();
      state.reading.set(index, controller);
      readers[stem]
        .read(index, state.mean, controller.signal)
        .then((page) => {
          if (state.reading.get(index) !== controller) {
            return;
          }
          state.reading.delete(index);
          deliver(stem, page);
          pump(stem);
        })
        .catch((error: unknown) => {
          if (state.reading.get(index) !== controller) {
            return;
          }
          state.reading.delete(index);
          options.failed(error);
        });
    }
  };

  const placeStem = (
    stem: StemType,
    placed: TrackWindow,
    dropped: PlayerPageKey[],
  ) => {
    const state = stems[stem];
    placeWindow(state, placed, dropped);
    for (const index of state.means.keys()) {
      if (!state.resident.has(index)) {
        state.means.delete(index);
      }
    }
    abortUnwanted(state, state.asked);
    readers[stem].setWanted(
      state.wanted.filter((index) => !state.resident.has(index)),
    );
  };

  let takeTracks: TakeTracks | undefined = undefined;

  const target = (next: PlayerWindow) => {
    window = next;
    const placed = placeSpans(next, played, sampleRate);
    const dropped: PlayerPageKey[] = [];
    for (const stem of stemTypes) {
      placeStem(stem, placed, dropped);
    }
    for (const state of takeTracks?.held() ?? []) {
      placeWindow(state, placed, dropped);
    }
    if (dropped.length > 0) {
      options.dropPages(dropped);
    }
    for (const stem of stemTypes) {
      pump(stem);
    }
    takeTracks?.pump();
  };

  const tracks = createTakeTracks({
    sources: options.takes,
    sampleRate,
    windowFrameCount:
      (behindSeconds + 2 * aheadSeconds + 2 * keepSeconds + loopPinSeconds) *
      sampleRate,
    putPage: options.putPage,
    setTakes: (message) => {
      options.setTakes({
        ...message,
        residentPageLimit: stemLimit + tracks.pageLimit(),
      });
    },
    retarget: () => {
      target(window);
    },
    failed: options.failed,
  });
  takeTracks = tracks;

  return {
    takes: () => ({
      takes: tracks.takes(),
      residentPageLimit: stemLimit + tracks.pageLimit(),
    }),
    setTakes: tracks.set,
    requestWindow: (next) => {
      played = next;
      target(next);
    },
    requestTarget: target,
    requestLeadPages: (indices) => {
      const { lead } = stems;
      for (const index of indices) {
        const mean = lead.means.get(index);
        if (mean) {
          lead.means.delete(index);
          options.putLeadPage({
            index,
            startFrame: lead.layout.pageStarts[index],
            samples: mean,
          });
        } else {
          lead.asked.add(index);
        }
      }
      pump('lead');
    },
    forgetPlayer: () => {
      for (const stem of stemTypes) {
        stems[stem].resident.clear();
        stems[stem].means.clear();
      }
      tracks.forget();
    },
    close: () => {
      for (const stem of stemTypes) {
        abortReads(stems[stem]);
      }
      tracks.close();
    },
  };
};
