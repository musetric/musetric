import { describe, expect, it } from 'vitest';
import {
  blockSize,
  burstCenters,
  burstLength,
  burstSeconds,
  createHarness,
  createTakeStream,
  nearestError,
  rate,
  runSamples,
  settle,
  timingTolerance,
  toRuns,
} from './player.fixtures.js';

const inputLatency = 384;

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

const toggleOutputLatency = 512;

type ToggledTake = {
  fromSeconds: number;
  toSeconds: number;
};

type LatencyCounts = {
  latencyFrameCount: number;
  inputLatencyFrameCount: number;
};

type Toggles = {
  tempo: number;
  playLatency: LatencyCounts;
  takes: ToggledTake[];
};

const recordTogglesThroughLoopback = async (toggles: Toggles) => {
  const { tempo, playLatency, takes } = toggles;
  const roundTrip = toggleOutputLatency + inputLatency;
  const harness = await createHarness([]);
  harness.player.methods.setTempoRatio({ tempoRatio: tempo });
  harness.player.methods.play({ revision: 1, ...playLatency });
  await settle();
  const streams = takes.map(() => createTakeStream());
  const blockAt = (seconds: number) =>
    Math.round((seconds / tempo) * (rate / blockSize));
  const lastBlock = Math.max(...takes.map((take) => blockAt(take.toSeconds)));
  const played: number[] = [];
  for (let block = 0; block <= lastBlock; block += 1) {
    for (const [index, take] of takes.entries()) {
      if (block === blockAt(take.fromSeconds)) {
        harness.player.methods.startRecording({
          frameIndex: 0,
          revision: 1,
          latencyFrameCount: roundTrip,
          inputLatencyFrameCount: inputLatency,
          notificationPort: streams[index].notification,
        });
        await settle();
      }
      if (block === blockAt(take.toSeconds)) {
        harness.player.methods.flushRecording();
        await settle();
      }
    }
    const input = new Float32Array(blockSize);
    for (let index = 0; index < blockSize; index += 1) {
      input[index] = played[block * blockSize + index - roundTrip] ?? 0;
    }
    played.push(...harness.process(input));
  }
  return {
    played: burstCenters(Float32Array.from(played)),
    takes: streams.map((stream) =>
      toRuns(stream.chunks).flatMap((run) =>
        burstCenters(runSamples(run)).map(
          (center) => run.startFrame + center * tempo,
        ),
      ),
    ),
  };
};

const toHalfSeconds = (centers: number[]) =>
  centers.map((center) => Math.round(center / (rate / 2)) / 2);

const songCenters = burstSeconds.map(
  (second) => second * rate + (burstLength - 1) / 2,
);

const recordUntilHeard = async (heardSeconds: number) => {
  const outputLatency = 512;
  const slowInput = 2048;
  const roundTrip = outputLatency + slowInput;
  const harness = await createHarness([]);
  const startFrame = Math.round(0.75 * rate);
  harness.player.methods.seek({ frameIndex: startFrame, revision: 1 });
  harness.player.methods.startRecording({
    frameIndex: startFrame,
    revision: 1,
    latencyFrameCount: roundTrip,
    inputLatencyFrameCount: slowInput,
    notificationPort: harness.notification,
  });
  harness.player.methods.play({
    revision: 1,
    latencyFrameCount: roundTrip,
    inputLatencyFrameCount: slowInput,
  });
  await settle();
  const played: number[] = [];
  const loopBack = (block: number) => {
    const input = new Float32Array(blockSize);
    for (let index = 0; index < blockSize; index += 1) {
      input[index] = played[block * blockSize + index - roundTrip] ?? 0;
    }
    return input;
  };
  const heardBlocks = Math.ceil(
    ((heardSeconds - 0.75) * rate + outputLatency) / blockSize,
  );
  for (let block = 0; block < heardBlocks; block += 1) {
    played.push(...harness.process(loopBack(block)));
  }
  harness.player.methods.stop({ revision: 2 });
  harness.player.methods.flushRecording();
  await settle();
  for (let block = heardBlocks; block < heardBlocks + 24; block += 1) {
    played.push(...harness.process(loopBack(block)));
  }
  await settle();
  return toRuns(harness.chunks).flatMap((run) =>
    burstCenters(runSamples(run)).map((center) => run.startFrame + center),
  );
};

describe('player recording loopback', () => {
  it('keeps what was sung right before the take stops', async () => {
    const centers = await recordUntilHeard(2 + (2 * burstLength + 240) / rate);
    expect(toHalfSeconds(centers)).toEqual([1, 1.5, 2]);
    for (const center of centers) {
      expect(Math.abs(nearestError(center, songCenters))).toBeLessThan(
        timingTolerance,
      );
    }
  });

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
      expect(toHalfSeconds(centers)).toEqual([1, 1.5, 3.5, 4, 4.5, 5]);
      for (const center of centers) {
        expect(Math.abs(nearestError(center, songCenters))).toBeLessThan(
          timingTolerance,
        );
      }
    },
  );

  it.each([
    ['the same latency', 1, toggleOutputLatency + inputLatency, inputLatency],
    ['an unknown latency', 1, 0, 0],
    ['a longer latency', 1, 4 * (toggleOutputLatency + inputLatency), 0],
    ['the same latency', 0.8, toggleOutputLatency + inputLatency, inputLatency],
    ['an unknown latency', 1.25, 0, 0],
    ['a longer latency', 0.8, 4 * (toggleOutputLatency + inputLatency), 0],
  ])(
    'places takes toggled during playback started with %s at tempo %f',
    async (_name, tempo, latencyFrameCount, inputLatencyFrameCount) => {
      const { played, takes } = await recordTogglesThroughLoopback({
        tempo,
        playLatency: { latencyFrameCount, inputLatencyFrameCount },
        takes: [
          { fromSeconds: 1.25, toSeconds: 2.75 },
          { fromSeconds: 3.25, toSeconds: 4.75 },
        ],
      });
      expect(takes.map(toHalfSeconds)).toEqual([
        [1.5, 2, 2.5],
        [3.5, 4, 4.5],
      ]);
      for (const center of takes.flat()) {
        expect(Math.abs(nearestError(center, songCenters))).toBeLessThan(
          timingTolerance,
        );
      }
      expect(played.length).toBeGreaterThan(5);
      for (const [index, center] of played.slice(1).entries()) {
        expect(
          Math.abs(center - played[index] - rate / 2 / tempo),
        ).toBeLessThan(timingTolerance);
      }
    },
  );
});
