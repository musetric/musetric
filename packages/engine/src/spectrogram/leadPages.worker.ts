import { type SpectrogramSource } from '@musetric/spectrogram';
import { findPageIndex, pageEndFrame } from '../player/pageLayout.cross.js';
import { type PlayerStemLayout } from '../player/protocol.cross.js';

const staleRenderCount = 120;

export type LeadPageRange = {
  frameIndex: number;
  frameCount: number;
};

export type LeadPages = {
  source: SpectrogramSource;
  put: (index: number, samples: Float32Array) => LeadPageRange | undefined;
  takeWanted: () => number[];
  sweep: () => void;
};

export const createLeadPages = (layout: PlayerStemLayout): LeadPages => {
  const { frameCount, pageStarts } = layout;
  const pages: (Float32Array | undefined)[] = pageStarts.map(() => undefined);
  const touched: number[] = pageStarts.map(() => -1);
  const requested = new Set<number>();
  const wanted = new Set<number>();
  let render = 0;

  const want = (index: number) => {
    if (
      index >= 0 &&
      index < pageStarts.length &&
      !pages[index] &&
      !requested.has(index)
    ) {
      wanted.add(index);
    }
  };

  const source: SpectrogramSource = {
    mapped: false,
    songLength: frameCount,
    length: frameCount,
    stretch: 1,
    reach: 1,
    position: (songFrame) => songFrame,
    transposeAt: () => 0,
    read: (target, targetOffset, from, count) => {
      target.fill(0, targetOffset, targetOffset + count);
      const end = Math.min(frameCount, from + count);
      let frame = Math.max(0, from);
      while (frame < end) {
        const index = findPageIndex(layout, frame);
        const start = pageStarts[index];
        const stop = Math.min(end, pageEndFrame(layout, index));
        touched[index] = render;
        const samples = pages[index];
        if (samples) {
          target.set(
            samples.subarray(frame - start, stop - start),
            targetOffset + frame - from,
          );
        } else {
          want(index);
        }
        want(index + 1);
        frame = stop;
      }
    },
  };

  return {
    source,
    put: (index, samples) => {
      requested.delete(index);
      if (index < 0 || index >= pageStarts.length) {
        return undefined;
      }
      pages[index] = samples;
      touched[index] = render;
      const frameIndex = pageStarts[index];
      return {
        frameIndex,
        frameCount: pageEndFrame(layout, index) - frameIndex,
      };
    },
    takeWanted: () => {
      const indices = [...wanted];
      wanted.clear();
      for (const index of indices) {
        requested.add(index);
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
    },
  };
};
