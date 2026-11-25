import { type StemType, stemTypes } from '@musetric/audio/es';
import { pageEndFrame } from '../player/pageLayout.cross.js';
import {
  type PlayerPage,
  type PlayerPageKey,
  type PlayerRange,
  type PlayerStemLayout,
  type PlayerWindow,
} from '../player/protocol.cross.js';
import { type SpectrogramLeadPage } from '../spectrogram/protocol.cross.js';
import { type StemPageReaders } from './stemPageReaders.worker.js';
import { type StemPageSamples } from './stemPages.cross.js';

const behindSeconds = 4;
const aheadSeconds = 8;
const keepSeconds = 4;
const loopPinSeconds = 4;
const readsPerStem = 2;

type FrameSpan = {
  from: number;
  to: number;
};

const pagesOf = (layout: PlayerStemLayout, spans: FrameSpan[]): number[] => {
  const found = new Set<number>();
  for (const span of spans) {
    const from = Math.max(0, span.from);
    const to = Math.min(layout.frameCount, span.to);
    for (let index = 0; index < layout.pageStarts.length; index += 1) {
      if (layout.pageStarts[index] < to && pageEndFrame(layout, index) > from) {
        found.add(index);
      }
    }
  }
  return [...found];
};

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

const playDistance = (
  layout: PlayerStemLayout,
  index: number,
  window: PlayerWindow,
): number => {
  const { frameIndex, loop } = window;
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

const byPlayDistance =
  (layout: PlayerStemLayout, window: PlayerWindow) =>
  (left: number, right: number) =>
    playDistance(layout, left, window) - playDistance(layout, right, window) ||
    left - right;

type StemReads = {
  layout: PlayerStemLayout;
  mean: boolean;
  wanted: number[];
  resident: Set<number>;
  reading: Map<number, AbortController>;
  asked: Set<number>;
  means: Map<number, Float32Array<ArrayBuffer>>;
};

export type PageReadsOptions = {
  readers: StemPageReaders;
  layouts: Record<StemType, PlayerStemLayout>;
  sampleRate: number;
  putPage: (page: PlayerPage) => void;
  dropPages: (pages: PlayerPageKey[]) => void;
  putLeadPage: (page: SpectrogramLeadPage) => void;
  failed: (error: unknown) => void;
};

export type PageReads = {
  residentLimit: number;
  requestWindow: (window: PlayerWindow) => void;
  requestTarget: (window: PlayerWindow) => void;
  requestLeadPages: (indices: number[]) => void;
  forgetPlayer: () => void;
  close: () => void;
};

export const createPageReads = (options: PageReadsOptions): PageReads => {
  const { readers, layouts, sampleRate } = options;
  const stems: Record<StemType, StemReads> = {
    lead: {
      layout: layouts.lead,
      mean: true,
      wanted: [],
      resident: new Set(),
      reading: new Map(),
      asked: new Set(),
      means: new Map(),
    },
    backing: {
      layout: layouts.backing,
      mean: false,
      wanted: [],
      resident: new Set(),
      reading: new Map(),
      asked: new Set(),
      means: new Map(),
    },
    instrumental: {
      layout: layouts.instrumental,
      mean: false,
      wanted: [],
      resident: new Set(),
      reading: new Map(),
      asked: new Set(),
      means: new Map(),
    },
  };
  let window: PlayerWindow = { frameIndex: 0 };
  let played = window;

  const deliver = (stem: StemType, page: StemPageSamples) => {
    const state = stems[stem];
    const { index } = page;
    if (state.wanted.includes(index) && !state.resident.has(index)) {
      state.resident.add(index);
      options.putPage({
        stem,
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
      ...[...state.asked].sort(byPlayDistance(state.layout, window)),
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

  const reads: PageReads = {
    residentLimit: stemTypes.reduce(
      (sum, stem) => sum + residentPageCount(layouts[stem], sampleRate),
      0,
    ),
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
                from: loop.fromFrame,
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
      for (const stem of stemTypes) {
        const state = stems[stem];
        const keep = new Set(pagesOf(state.layout, keepSpans));
        for (const index of state.resident) {
          if (!keep.has(index)) {
            state.resident.delete(index);
            state.means.delete(index);
            dropped.push({ stem, index });
          }
        }
        state.wanted = pagesOf(state.layout, wantSpans).sort(
          byPlayDistance(state.layout, next),
        );
        for (const [index, controller] of state.reading) {
          if (!state.wanted.includes(index) && !state.asked.has(index)) {
            controller.abort();
            state.reading.delete(index);
          }
        }
        readers[stem].setWanted(
          state.wanted.filter((index) => !state.resident.has(index)),
        );
      }
      if (dropped.length > 0) {
        options.dropPages(dropped);
      }
      for (const stem of stemTypes) {
        pump(stem);
      }
    },
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
    },
    close: () => {
      for (const stem of stemTypes) {
        for (const controller of stems[stem].reading.values()) {
          controller.abort();
        }
        stems[stem].reading.clear();
      }
    },
  };
  return reads;
};
