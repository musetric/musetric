import { type StemType, stemTypes } from '@musetric/audio/es';
import { describe, expect, it } from 'vitest';
import { findPageIndex } from '../../player/pageLayout.cross.js';
import {
  type PlayerRange,
  type PlayerStemLayout,
  type PlayerWindow,
} from '../../player/protocol.cross.js';
import { createPlayerPages } from '../playerPages.worker.js';
import {
  type StemPageReader,
  type StemPageReaders,
} from '../stemPageReaders.worker.js';
import { type StemPageSamples } from '../stemPages.cross.js';

const sampleRate = 48_000;
const blockFrames = 4096;
const reportFrames = 12_000;
const readyMarginFrames = 16_384;
const readyStepFrames = 4096;

const createLayout = (): PlayerStemLayout => {
  const pageStarts: number[] = [];
  let frame = 0;
  for (let index = 0; index < 108; index += 1) {
    pageStarts.push(frame);
    frame += (index % 2 === 0 ? 23 : 24) * blockFrames;
  }
  return { frameCount: frame - 50_000, pageStarts };
};

const readyPages = (
  layout: PlayerStemLayout,
  frameIndex: number,
  loop?: PlayerRange,
): Set<number> => {
  const found = new Set<number>();
  for (
    let at = frameIndex - readyMarginFrames;
    at <= frameIndex + readyMarginFrames;
    at += readyStepFrames
  ) {
    const songFrame =
      loop && at >= loop.toFrame
        ? loop.fromFrame +
          ((at - loop.fromFrame) % (loop.toFrame - loop.fromFrame))
        : at;
    const index = findPageIndex(layout, songFrame);
    if (index >= 0) {
      found.add(index);
    }
  }
  return found;
};

const settle = async () =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

type Read = {
  stem: StemType;
  index: number;
  signal: AbortSignal;
  finished: boolean;
  finish: () => void;
};

const createPages = (gated: boolean) => {
  const layout = createLayout();
  const reads: Read[] = [];
  const readerOf = (stem: StemType): StemPageReader => ({
    open: async () =>
      Promise.resolve({
        frameCount: layout.frameCount,
        channelCount: 2,
        pageStarts: layout.pageStarts,
      }),
    read: async (index, _mono, signal) =>
      new Promise<StemPageSamples>((resolve) => {
        const read: Read = {
          stem,
          index,
          signal,
          finished: false,
          finish: () => {
            read.finished = true;
            resolve({
              id: index,
              index,
              startFrame: layout.pageStarts[index],
              frameCount: 1,
              samples: new Float32Array(2),
            });
          },
        };
        reads.push(read);
        if (!gated) {
          read.finish();
        }
      }),
  });
  const readers: StemPageReaders = {
    lead: readerOf('lead'),
    backing: readerOf('backing'),
    instrumental: readerOf('instrumental'),
  };
  const resident: Record<StemType, Set<number>> = {
    lead: new Set(),
    backing: new Set(),
    instrumental: new Set(),
  };
  let most = 0;
  const pages = createPlayerPages({
    readers,
    layouts: { lead: layout, backing: layout, instrumental: layout },
    sampleRate,
    putPage: (page) => {
      resident[page.stem].add(page.index);
      most = Math.max(
        most,
        stemTypes.reduce((sum, stem) => sum + resident[stem].size, 0),
      );
    },
    dropPages: (dropped) => {
      for (const page of dropped) {
        resident[page.stem].delete(page.index);
      }
    },
    failed: (error) => {
      throw error;
    },
  });
  const play = async (windows: PlayerWindow[]) => {
    for (const window of windows) {
      pages.requestWindow(window);
      await settle();
    }
  };
  const indicesOf = (stem: StemType, from = 0) =>
    reads
      .slice(from)
      .filter((read) => read.stem === stem)
      .map((read) => read.index);
  return {
    pages,
    layout,
    reads,
    resident,
    play,
    indicesOf,
    most: () => most,
  };
};

const span = (fromSeconds: number, toSeconds: number) =>
  Array.from(
    {
      length: Math.floor(
        ((toSeconds - fromSeconds) * sampleRate) / reportFrames,
      ),
    },
    (_, step) => fromSeconds * sampleRate + step * reportFrames,
  );

describe('player pages', () => {
  it('never holds more pages than its resident limit', async () => {
    const { pages, layout, play, most } = createPages(false);
    await play(span(0, 40).map((frameIndex) => ({ frameIndex })));
    await play(span(120, 140).map((frameIndex) => ({ frameIndex })));
    await play(span(10, 25).map((frameIndex) => ({ frameIndex })));
    const long = { fromFrame: 60 * sampleRate, toFrame: 100 * sampleRate };
    await play(span(85, 97).map((frameIndex) => ({ frameIndex })));
    await play(span(97, 100).map((frameIndex) => ({ frameIndex, loop: long })));
    for (let cycle = 0; cycle < 2; cycle += 1) {
      await play(
        span(60, 100).map((frameIndex) => ({ frameIndex, loop: long })),
      );
    }
    const short = { fromFrame: 30 * sampleRate, toFrame: 34 * sampleRate };
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await play(
        span(30, 34).map((frameIndex) => ({ frameIndex, loop: short })),
      );
    }
    const end = {
      fromFrame: layout.frameCount - 30 * sampleRate,
      toFrame: layout.frameCount,
    };
    await play(
      span(end.fromFrame / sampleRate, layout.frameCount / sampleRate).map(
        (frameIndex) => ({ frameIndex, loop: end }),
      ),
    );

    expect(most()).toBeGreaterThan(0);
    expect(most()).toBeLessThanOrEqual(pages.residentLimit);
    expect(pages.residentLimit).toBeLessThan(
      stemTypes.length * layout.pageStarts.length,
    );
  });

  it('reads first the pages that ready needs on both sides of the cursor', async () => {
    const { pages, layout, indicesOf } = createPages(true);
    const frameIndex = layout.pageStarts[20] + 5000;

    pages.requestWindow({ frameIndex });
    await settle();

    for (const stem of stemTypes) {
      expect(new Set(indicesOf(stem))).toEqual(readyPages(layout, frameIndex));
    }
  });

  it('reads first the start of the loop when the cursor is about to turn', async () => {
    const { pages, layout, indicesOf } = createPages(true);
    const loop = {
      fromFrame: layout.pageStarts[10] + 1000,
      toFrame: layout.pageStarts[30] + 50_000,
    };
    const frameIndex = loop.toFrame - 8000;

    pages.requestWindow({ frameIndex, loop });
    await settle();

    const ready = readyPages(layout, frameIndex, loop);
    expect(ready).toEqual(new Set([30, 10]));
    for (const stem of stemTypes) {
      expect(new Set(indicesOf(stem))).toEqual(ready);
    }
  });

  it('gives the places of the old reads to the new cursor after a far seek', async () => {
    const { pages, layout, reads, resident, indicesOf } = createPages(true);
    pages.requestWindow({ frameIndex: 0 });
    await settle();
    const old = [...reads];
    const frameIndex = layout.pageStarts[60] + 5000;

    pages.requestWindow({ frameIndex });
    await settle();

    expect(old).toHaveLength(2 * stemTypes.length);
    expect(old.every((read) => read.signal.aborted)).toBe(true);
    const ready = readyPages(layout, frameIndex);
    for (const stem of stemTypes) {
      expect(new Set(indicesOf(stem, old.length))).toEqual(ready);
    }
    for (const read of old) {
      read.finish();
    }
    await settle();
    for (const stem of stemTypes) {
      expect(resident[stem]).toEqual(new Set());
    }
    for (const read of reads.slice(old.length)) {
      read.finish();
    }
    await settle();
    for (const stem of stemTypes) {
      expect(resident[stem]).toEqual(ready);
    }
  });
});
