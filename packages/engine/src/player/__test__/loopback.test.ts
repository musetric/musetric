import { describe, expect, it } from 'vitest';
import { type LiveTakeChunk } from '../protocol.cross.js';
import {
  blockSize,
  burstCenters,
  burstLength,
  burstSeconds,
  createHarness,
  rate,
  settle,
  timingTolerance,
} from './player.fixtures.js';

const inputLatency = 384;

const nearestError = (value: number, targets: readonly number[]): number =>
  targets.reduce(
    (best, target) =>
      Math.abs(value - target) < Math.abs(best) ? value - target : best,
    Number.POSITIVE_INFINITY,
  );

type TakeRun = {
  startFrame: number;
  chunks: LiveTakeChunk[];
};

const toRuns = (chunks: readonly LiveTakeChunk[]): TakeRun[] => {
  const runs: TakeRun[] = [];
  for (const chunk of chunks) {
    const last = runs.at(-1);
    if (last && chunk.offset > 0 && last.startFrame === chunk.startFrame) {
      last.chunks.push(chunk);
    } else {
      runs.push({ startFrame: chunk.startFrame, chunks: [chunk] });
    }
  }
  return runs;
};

const runSamples = (run: TakeRun): Float32Array => {
  const last = run.chunks.at(-1);
  const samples = new Float32Array(
    last ? last.offset + last.samples.length : 0,
  );
  for (const chunk of run.chunks) {
    samples.set(chunk.samples, chunk.offset);
  }
  return samples;
};

type Seek = {
  fromSeconds: number;
  toSeconds: number;
};

type Loopback = {
  tempo: number;
  startSeconds: number;
  outputLatency: number;
  seek?: Seek;
};

const recordRunsThroughLoopback = async (loopback: Loopback) => {
  const { tempo, startSeconds, outputLatency, seek } = loopback;
  const roundTrip = outputLatency + inputLatency;
  const harness = await createHarness([]);
  const startFrame = Math.round(startSeconds * rate);
  harness.player.methods.setTempoRatio({ tempoRatio: tempo });
  harness.player.methods.seek({ frameIndex: startFrame, revision: 1 });
  harness.player.methods.startRecording({
    frameIndex: startFrame,
    revision: 1,
    latencyFrameCount: roundTrip,
    inputLatencyFrameCount: inputLatency,
    notificationPort: harness.notification,
  });
  harness.player.methods.play({
    revision: 1,
    latencyFrameCount: roundTrip,
    inputLatencyFrameCount: inputLatency,
  });
  await settle();
  const played: number[] = [];
  const blocksOf = (seconds: number) =>
    Math.round((seconds / tempo) * (rate / blockSize));
  const seekBlock = seek ? blocksOf(seek.fromSeconds - startSeconds) : -1;
  const sungSeconds = seek
    ? seek.fromSeconds - startSeconds + 5.25 - seek.toSeconds
    : 5.25 - startSeconds;
  const blocks = Math.ceil((sungSeconds / tempo) * (rate / blockSize));
  for (let block = 0; block < blocks; block += 1) {
    if (seek && block === seekBlock) {
      harness.player.methods.seek({
        frameIndex: Math.round(seek.toSeconds * rate),
        revision: 2,
      });
      await settle();
    }
    const input = new Float32Array(blockSize);
    for (let index = 0; index < blockSize; index += 1) {
      input[index] = played[block * blockSize + index - roundTrip] ?? 0;
    }
    played.push(...harness.process(input));
  }
  harness.player.methods.flushRecording();
  await settle();
  return toRuns(harness.chunks).map((run) => ({
    startFrame: run.startFrame,
    centers: burstCenters(runSamples(run)).map(
      (center) => run.startFrame + center * tempo,
    ),
  }));
};

const recordThroughLoopback = async (loopback: Loopback) => {
  const runs = await recordRunsThroughLoopback(loopback);
  return runs.flatMap((run) => run.centers);
};

const songCenters = burstSeconds.map(
  (second) => second * rate + (burstLength - 1) / 2,
);

describe('player recording loopback', () => {
  it('places a take recorded at the original tempo on the song', async () => {
    const centers = await recordThroughLoopback({
      tempo: 1,
      startSeconds: 0.75,
      outputLatency: 512,
    });
    expect(centers.length).toBeGreaterThan(5);
    for (const center of centers) {
      expect(Math.abs(nearestError(center, songCenters))).toBeLessThan(1);
    }
  });

  it.each([0.5, 0.8, 1.25])(
    'places a take recorded at tempo %f on the song',
    async (tempo) => {
      const centers = await recordThroughLoopback({
        tempo,
        startSeconds: 0.75,
        outputLatency: 512,
      });
      expect(centers.length).toBeGreaterThan(5);
      for (const center of centers) {
        expect(Math.abs(nearestError(center, songCenters))).toBeLessThan(
          timingTolerance,
        );
      }
    },
  );

  it.each([0.5, 0.8, 1.25])(
    'places a take started at the song start at tempo %f',
    async (tempo) => {
      const centers = await recordThroughLoopback({
        tempo,
        startSeconds: 0,
        outputLatency: rate / 10,
      });
      expect(centers.length).toBeGreaterThan(5);
      for (const center of centers) {
        expect(Math.abs(nearestError(center, songCenters))).toBeLessThan(
          timingTolerance,
        );
      }
    },
  );

  it.each([1, 0.8, 1.25])(
    'starts a new run where a seek moves a take at tempo %f',
    async (tempo) => {
      const runs = await recordRunsThroughLoopback({
        tempo,
        startSeconds: 0.75,
        outputLatency: 512,
        seek: { fromSeconds: 1.75, toSeconds: 3.25 },
      });
      expect(runs.map((run) => run.startFrame)).toEqual([
        0.75 * rate,
        3.25 * rate,
      ]);
      const centers = runs.flatMap((run) => run.centers);
      expect(
        centers.map((center) => Math.round(center / (rate / 2)) / 2),
      ).toEqual([1, 1.5, 3.5, 4, 4.5, 5]);
      for (const center of centers) {
        expect(Math.abs(nearestError(center, songCenters))).toBeLessThan(
          timingTolerance,
        );
      }
    },
  );
});
