import {
  type LiveTakeChunk,
  type LiveTakeStart,
} from '../player/protocol.cross.js';
import { createRecordingPacket } from './recordingStream.worker.js';

const pageSeconds = 2;
const packetSeconds = 0.05;

export const takePageFrameCount = (sampleRate: number): number =>
  Math.round(sampleRate * pageSeconds);

export type HeldRun = {
  startFrame: number;
  frameCount: number;
};

export type HeldTake = LiveTakeStart & {
  runs: HeldRun[];
  read: (run: number, from: number, to: number) => Float32Array<ArrayBuffer>;
};

type PagedRun = HeldRun & {
  sentFrameCount: number;
  pages: Float32Array<ArrayBuffer>[];
};

type PageSpan = (
  page: Float32Array<ArrayBuffer>,
  pageOffset: number,
  at: number,
  count: number,
) => void;

export type TakePages = {
  push: (chunk: LiveTakeChunk) => void;
  hold: (held: readonly HeldRun[]) => void;
  cut: (whole: boolean) => ArrayBuffer | undefined;
  runs: () => HeldRun[];
  read: (run: number, from: number, to: number) => Float32Array<ArrayBuffer>;
};

export const createTakePages = (sampleRate: number): TakePages => {
  const pageFrameCount = takePageFrameCount(sampleRate);
  const packetFrameCount = Math.round(sampleRate * packetSeconds);
  const runs: PagedRun[] = [];

  const walk = (
    run: PagedRun,
    offset: number,
    length: number,
    span: PageSpan,
  ) => {
    for (let at = 0; at < length;) {
      const frame = offset + at;
      const index = Math.floor(frame / pageFrameCount);
      const pageOffset = frame - index * pageFrameCount;
      const count = Math.min(length - at, pageFrameCount - pageOffset);
      while (run.pages.length <= index) {
        run.pages.push(new Float32Array(pageFrameCount));
      }
      span(run.pages[index], pageOffset, at, count);
      at += count;
    }
  };

  const copy = (run: PagedRun, offset: number, length: number) => {
    const samples = new Float32Array(length);
    walk(run, offset, length, (page, pageOffset, at, count) => {
      samples.set(page.subarray(pageOffset, pageOffset + count), at);
    });
    return samples;
  };

  const findRun = (chunk: LiveTakeChunk): PagedRun => {
    const last = runs.at(-1);
    if (last && chunk.offset > 0 && last.startFrame === chunk.startFrame) {
      return last;
    }
    const run: PagedRun = {
      startFrame: chunk.startFrame,
      frameCount: 0,
      sentFrameCount: 0,
      pages: [],
    };
    runs.push(run);
    return run;
  };

  return {
    push: (chunk) => {
      const run = findRun(chunk);
      const { samples } = chunk;
      walk(run, chunk.offset, samples.length, (page, pageOffset, at, count) => {
        page.set(samples.subarray(at, at + count), pageOffset);
      });
      run.frameCount = Math.max(run.frameCount, chunk.offset + samples.length);
    },
    hold: (held) => {
      let next = 0;
      for (const run of runs) {
        const match = held.at(next);
        if (match?.startFrame === run.startFrame) {
          run.sentFrameCount = match.frameCount;
          next += 1;
        } else {
          run.sentFrameCount = 0;
        }
      }
    },
    cut: (whole) => {
      const index = runs.findIndex(
        (run) => run.sentFrameCount < run.frameCount,
      );
      if (index === -1) {
        return undefined;
      }
      const run = runs[index];
      const unsent = run.frameCount - run.sentFrameCount;
      if (!whole && index === runs.length - 1 && unsent < packetFrameCount) {
        return undefined;
      }
      const offset = run.sentFrameCount;
      const samples = copy(run, offset, Math.min(unsent, packetFrameCount));
      run.sentFrameCount += samples.length;
      return createRecordingPacket({
        startFrame: run.startFrame,
        offset,
        samples,
      });
    },
    runs: () =>
      runs.map((run) => ({
        startFrame: run.startFrame,
        frameCount: run.frameCount,
      })),
    read: (run, from, to) => copy(runs[run], from, to - from),
  };
};
