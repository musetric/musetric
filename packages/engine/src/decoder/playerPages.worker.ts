import { type StemType, stemTypes } from '@musetric/audio/es';
import { pageEndFrame } from '../player/pageLayout.cross.js';
import {
  type PlayerPage,
  type PlayerPageKey,
  type PlayerRange,
  type PlayerStemLayout,
  type PlayerWindow,
} from '../player/protocol.cross.js';
import { type StemPageReaders } from './stemPageReaders.worker.js';

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

type StemState = {
  layout: PlayerStemLayout;
  resident: Set<number>;
  reading: Set<number>;
};

export type PlayerPagesOptions = {
  readers: StemPageReaders;
  layouts: Record<StemType, PlayerStemLayout>;
  sampleRate: number;
  putPage: (page: PlayerPage) => void;
  dropPages: (pages: PlayerPageKey[]) => void;
  failed: (error: unknown) => void;
};

export type PlayerPages = {
  requestWindow: (window: PlayerWindow) => void;
  close: () => void;
};

export const createPlayerPages = (options: PlayerPagesOptions): PlayerPages => {
  const { readers, layouts, sampleRate } = options;
  const stems: Record<StemType, StemState> = {
    lead: { layout: layouts.lead, resident: new Set(), reading: new Set() },
    backing: {
      layout: layouts.backing,
      resident: new Set(),
      reading: new Set(),
    },
    instrumental: {
      layout: layouts.instrumental,
      resident: new Set(),
      reading: new Set(),
    },
  };
  let wanted: Record<StemType, number[]> = {
    lead: [],
    backing: [],
    instrumental: [],
  };
  let closed = false;

  const pump = (stem: StemType) => {
    const state = stems[stem];
    for (const index of wanted[stem]) {
      if (state.reading.size >= readsPerStem) {
        return;
      }
      if (state.resident.has(index) || state.reading.has(index)) {
        continue;
      }
      state.reading.add(index);
      readers[stem]
        .read(index, false)
        .then((page) => {
          state.reading.delete(index);
          if (closed) {
            return;
          }
          state.resident.add(index);
          options.putPage({
            stem,
            index,
            frameCount: page.frameCount,
            channelCount: page.samples.length / page.frameCount,
            samples: page.samples,
          });
          pump(stem);
        })
        .catch((error: unknown) => {
          state.reading.delete(index);
          if (!closed) {
            options.failed(error);
          }
        });
    }
  };

  return {
    requestWindow: (window) => {
      const { frameIndex, loop } = window;
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
      ];
      const dropped: PlayerPageKey[] = [];
      const nextWanted: Record<StemType, number[]> = {
        lead: [],
        backing: [],
        instrumental: [],
      };
      for (const stem of stemTypes) {
        const state = stems[stem];
        const keep = new Set(pagesOf(state.layout, keepSpans));
        for (const index of state.resident) {
          if (!keep.has(index)) {
            state.resident.delete(index);
            dropped.push({ stem, index });
          }
        }
        nextWanted[stem] = pagesOf(state.layout, wantSpans).sort(
          (left, right) =>
            Math.abs(state.layout.pageStarts[left] - frameIndex) -
            Math.abs(state.layout.pageStarts[right] - frameIndex),
        );
      }
      wanted = nextWanted;
      if (dropped.length > 0) {
        options.dropPages(dropped);
      }
      for (const stem of stemTypes) {
        pump(stem);
      }
    },
    close: () => {
      closed = true;
    },
  };
};
