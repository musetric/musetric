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
import { createTakeTracks, type TakeSource } from './takeTracks.worker.js';
import {
  abortReads,
  byPlayDistance,
  createTrackReads,
  type FrameSpan,
  pagesOf,
  type TrackPage,
  type TrackReads,
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
  setTakes: (sources: TakeSource[]) => void;
  requestWindow: (window: PlayerWindow) => void;
  requestTarget: (window: PlayerWindow) => void;
  requestLeadPages: (indices: number[]) => void;
  forgetPlayer: () => void;
  close: () => void;
};

export const createPageReads = (options: PageReadsOptions): PageReads => {
  const { readers, layouts, sampleRate } = options;
  const stems = stemTypes.map((stem) => ({
    ...createTrackReads(
      stemTracks[stem],
      layouts[stem],
      async (index, signal) =>
        readers[stem].read(
          index,
          { samples: true, mean: stem === 'lead' },
          signal,
        ),
      stem === 'lead'
        ? async (index, signal) =>
            readers[stem].read(index, { samples: false, mean: true }, signal)
        : undefined,
    ),
    setWanted: readers[stem].setWanted,
  }));
  const [lead] = stems;
  const stemLimit = stemTypes.reduce(
    (sum, stem) => sum + residentPageCount(layouts[stem], sampleRate),
    0,
  );
  const takes = createTakeTracks({
    sources: options.takes,
    sampleRate,
    windowFrameCount:
      (behindSeconds + 2 * aheadSeconds + 2 * keepSeconds + loopPinSeconds) *
      sampleRate,
  });
  let window: PlayerWindow = { frameIndex: 0 };
  let played = window;

  const tracks = () => [...stems, ...takes.held()];

  const takePlan = (): PlayerTakes => ({
    takes: takes.layouts(),
    residentPageLimit: stemLimit + takes.pageLimit(),
  });

  const relay = (dropped: TrackReads[]) => {
    dropped.forEach(abortReads);
    options.setTakes(takePlan());
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    reads.requestTarget(window);
  };

  const settle = () => {
    const waiting = takes.waiting();
    if (
      waiting?.every(
        (state) =>
          state.failed ||
          !state.wanted.some((index) => !state.resident.has(index)),
      )
    ) {
      relay(takes.commit());
    }
  };

  const deliver = (state: TrackReads, page: TrackPage) => {
    const { index } = page;
    state.failed = false;
    if (
      page.samples &&
      state.wanted.includes(index) &&
      !state.resident.has(index)
    ) {
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

  const pump = (state: TrackReads) => {
    const missing = state.wanted.filter((index) => !state.resident.has(index));
    for (const index of missing) {
      if (state.meanOnly.delete(index)) {
        state.reading.get(index)?.abort();
        state.reading.delete(index);
      }
    }
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
      const meanOnly = !missing.includes(index) && state.readMean;
      if (meanOnly) {
        state.meanOnly.add(index);
      }
      (meanOnly || state.read)(index, controller.signal)
        .then((page) => {
          if (state.reading.get(index) !== controller) {
            return;
          }
          state.reading.delete(index);
          state.meanOnly.delete(index);
          deliver(state, page);
          pump(state);
          settle();
        })
        .catch((error: unknown) => {
          if (state.reading.get(index) !== controller) {
            return;
          }
          state.reading.delete(index);
          state.meanOnly.delete(index);
          state.failed = true;
          options.failed(error);
          settle();
        });
    }
  };

  const reads: PageReads = {
    takes: takePlan,
    setTakes: (sources) => {
      relay(takes.set(sources));
    },
    requestWindow: (next) => {
      played = next;
      reads.requestTarget(next);
    },
    requestTarget: (next) => {
      window = next;
      const { frameIndex, loop } = next;
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
        ...aheadSpans(
          played.frameIndex,
          aheadSeconds * sampleRate,
          played.loop,
        ),
      ];
      const dropped: PlayerPageKey[] = [];
      for (const state of tracks()) {
        const keep = new Set(pagesOf(state, keepSpans));
        for (const index of state.resident) {
          if (!keep.has(index)) {
            state.resident.delete(index);
            state.means.delete(index);
            dropped.push({ track: state.track, index });
          }
        }
        state.wanted = pagesOf(state, wantSpans).sort(
          byPlayDistance(state, next),
        );
        for (const [index, controller] of state.reading) {
          if (!state.wanted.includes(index) && !state.asked.has(index)) {
            controller.abort();
            state.reading.delete(index);
            state.meanOnly.delete(index);
          }
        }
        state.setWanted(
          state.wanted.filter((index) => !state.resident.has(index)),
        );
      }
      if (dropped.length > 0) {
        options.dropPages(dropped);
      }
      tracks().forEach(pump);
      settle();
    },
    requestLeadPages: (indices) => {
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
      pump(lead);
    },
    forgetPlayer: () => {
      takes.commit().forEach(abortReads);
      for (const state of tracks()) {
        state.resident.clear();
        state.means.clear();
      }
    },
    close: () => {
      tracks().forEach(abortReads);
    },
  };
  return reads;
};
