import { type SpectrogramSource, visitSamples } from '@musetric/spectrogram';
import { findPageIndex, pageEndFrame } from '../player/pageLayout.cross.js';
import { type PlayerStemLayout } from '../player/protocol.cross.js';

const staleRenderCount = 120;

export type PageRange = {
  frameIndex: number;
  frameCount: number;
};

export type TrackPages = {
  forEachRun: SpectrogramSource['forEachRun'];
  put: (index: number, samples: Float32Array) => PageRange | undefined;
  write: (offset: number, samples: Float32Array) => number;
  missing: (from: number, to: number) => boolean;
  relayout: (layout: PlayerStemLayout) => void;
  takeWanted: () => number[];
  sweep: () => void;
};

export const createTrackPages = (initial: PlayerStemLayout): TrackPages => {
  let layout = initial;
  let pages: (Float32Array | undefined)[] = layout.pageStarts.map(
    () => undefined,
  );
  let touched: number[] = layout.pageStarts.map(() => -1);
  const requested = new Map<number, number>();
  const wanted = new Set<number>();
  let render = 0;

  const want = (index: number) => {
    if (
      index >= 0 &&
      index < pages.length &&
      !pages[index] &&
      !requested.has(index)
    ) {
      wanted.add(index);
    }
  };

  return {
    forEachRun: (from, count, run) => {
      const { frameCount, pageStarts } = layout;
      const end = Math.min(frameCount, from + count);
      let frame = Math.max(0, from);
      if (frame > from) {
        run(undefined, 0, 0, Math.min(frame, from + count) - from);
      }
      while (frame < end) {
        const index = findPageIndex(layout, frame);
        const start = pageStarts[index];
        const stop = Math.min(end, pageEndFrame(layout, index));
        touched[index] = render;
        const samples = pages[index];
        if (samples) {
          visitSamples(
            {
              samples,
              samplesStart: frame - start,
              offset: frame - from,
              count: stop - frame,
            },
            run,
          );
        } else {
          run(undefined, 0, frame - from, stop - frame);
          want(index);
        }
        want(index + 1);
        frame = stop;
      }
      const covered = Math.max(Math.max(0, from), end);
      if (from + count > covered) {
        run(undefined, 0, covered - from, from + count - covered);
      }
    },
    put: (index, samples) => {
      requested.delete(index);
      if (index < 0 || index >= pages.length) {
        return undefined;
      }
      pages[index] = samples;
      touched[index] = render;
      const frameIndex = layout.pageStarts[index];
      return {
        frameIndex,
        frameCount: pageEndFrame(layout, index) - frameIndex,
      };
    },
    write: (offset, samples) => {
      const end = Math.min(layout.frameCount, offset + samples.length);
      let frame = Math.max(0, offset);
      while (frame < end) {
        const index = findPageIndex(layout, frame);
        const start = layout.pageStarts[index];
        const pageEnd = pageEndFrame(layout, index);
        const stop = Math.min(end, pageEnd);
        let page = pages[index];
        if (!page || page.length < pageEnd - start) {
          const grown = new Float32Array(pageEnd - start);
          if (page) {
            grown.set(page);
          }
          page = grown;
          pages[index] = grown;
        }
        page.set(
          samples.subarray(frame - offset, stop - offset),
          frame - start,
        );
        touched[index] = render;
        frame = stop;
      }
      return end;
    },
    missing: (from, to) => {
      let missing = false;
      const end = Math.min(layout.frameCount, to);
      let frame = Math.max(0, from);
      while (frame < end) {
        const index = findPageIndex(layout, frame);
        if (pages[index]) {
          touched[index] = render;
        } else {
          want(index);
          missing = true;
        }
        frame = pageEndFrame(layout, index);
      }
      return missing;
    },
    relayout: (next) => {
      layout = next;
      pages = next.pageStarts.map((_, index) => pages[index]);
      touched = next.pageStarts.map((_, index) => touched[index] ?? -1);
      for (const index of [...requested.keys(), ...wanted]) {
        if (index >= pages.length) {
          requested.delete(index);
          wanted.delete(index);
        }
      }
    },
    takeWanted: () => {
      const indices = [...wanted];
      wanted.clear();
      for (const index of indices) {
        requested.set(index, render);
      }
      return indices;
    },
    sweep: () => {
      render += 1;
      for (let index = 0; index < pages.length; index += 1) {
        if (pages[index] && touched[index] < render - staleRenderCount) {
          pages[index] = undefined;
        }
      }
      for (const [index, at] of requested) {
        if (at < render - staleRenderCount) {
          requested.delete(index);
        }
      }
    },
  };
};

export const toPlainSource = (
  frameCount: number,
  pages: TrackPages,
): SpectrogramSource => ({
  mapped: false,
  songLength: frameCount,
  length: frameCount,
  stretch: 1,
  reach: 1,
  position: (songFrame) => songFrame,
  transposeAt: () => 0,
  forEachRun: pages.forEachRun,
});
