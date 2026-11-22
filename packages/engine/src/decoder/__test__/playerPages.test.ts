import { type StemType, stemTypes } from '@musetric/audio/es';
import { describe, expect, it } from 'vitest';
import {
  type PlayerStemLayout,
  type PlayerWindow,
} from '../../player/protocol.cross.js';
import { createPlayerPages } from '../playerPages.worker.js';
import {
  type StemPageReader,
  type StemPageReaders,
} from '../stemPageReaders.worker.js';

const sampleRate = 48_000;
const blockFrames = 4096;
const reportFrames = 12_000;

const createLayout = (): PlayerStemLayout => {
  const pageStarts: number[] = [];
  let frame = 0;
  for (let index = 0; index < 108; index += 1) {
    pageStarts.push(frame);
    frame += (index % 2 === 0 ? 23 : 24) * blockFrames;
  }
  return { frameCount: frame - 50_000, pageStarts };
};

const settle = async () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

const createPages = () => {
  const layout = createLayout();
  const reader: StemPageReader = {
    open: async () =>
      Promise.resolve({
        frameCount: layout.frameCount,
        channelCount: 2,
        pageStarts: layout.pageStarts,
      }),
    read: async (index) =>
      Promise.resolve({
        id: index,
        index,
        startFrame: layout.pageStarts[index],
        frameCount: 1,
        samples: new Float32Array(2),
      }),
  };
  const readers: StemPageReaders = {
    lead: reader,
    backing: reader,
    instrumental: reader,
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
  return { pages, layout, play, most: () => most };
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
    const { pages, layout, play, most } = createPages();
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
});
