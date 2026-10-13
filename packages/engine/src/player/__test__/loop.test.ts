import { describe, expect, it } from 'vitest';
import { type PlayerRange, type PlayerRangeRepeat } from '../protocol.cross.js';
import {
  blockSize,
  burstCenters,
  burstLength,
  burstSeconds,
  createHarness,
  createTakeStream,
  type Harness,
  nearestError,
  rate,
  runSamples,
  settle,
  timingTolerance,
  toRuns,
} from './player.fixtures.js';

const inputLatency = 384;
const outputLatency = 512;
const roundTrip = inputLatency + outputLatency;

const loop: PlayerRange = {
  fromFrame: 1.25 * rate,
  toFrame: 3.25 * rate,
};
const loopLength = loop.toFrame - loop.fromFrame;

const loopCenters = burstSeconds
  .map((second) => second * rate + (burstLength - 1) / 2)
  .filter((center) => center >= loop.fromFrame && center < loop.toFrame);

const loopPlayCenters = (tempo: number, passes: number) =>
  Array.from({ length: passes }, (_, pass) => pass).flatMap((pass) =>
    loopCenters.map(
      (center) => (center - loop.fromFrame + pass * loopLength) / tempo,
    ),
  );

type PassEvent = 'started' | 'complete' | 'cancelled';

const listenToPasses = (
  harness: Harness,
  stops: number[] = [],
): PassEvent[] => {
  const events: PassEvent[] = [];
  harness.player.bindHandlers({
    booted: () => undefined,
    setPlaying: (message) => {
      if (!message.playing) {
        stops.push(message.frameIndex);
      }
    },
    recordingFlushed: () => undefined,
    recordingPassStarted: () => {
      events.push('started');
    },
    recordingPassEnded: (message) => {
      events.push(message.complete ? 'complete' : 'cancelled');
    },
  });
  return events;
};

const startRecording = (harness: Harness, notificationPort: MessagePort) => {
  harness.player.methods.startRecording({
    frameIndex: loop.fromFrame,
    revision: 1,
    latencyFrameCount: roundTrip,
    inputLatencyFrameCount: inputLatency,
    notificationPort,
    pass: true,
  });
};

const playLoop = async (
  tempo: number,
  passes: number,
  repeat: PlayerRangeRepeat = 'cycle',
  stopFrame?: number,
) => {
  const harness = await createHarness([]);
  const stops: number[] = [];
  listenToPasses(harness, stops);
  harness.player.methods.setTempoRatio({ tempoRatio: tempo });
  harness.player.methods.setRange({ range: loop, repeat, stopFrame });
  harness.player.methods.seek({ frameIndex: loop.fromFrame, revision: 1 });
  harness.player.methods.play({
    revision: 1,
    latencyFrameCount: 0,
    inputLatencyFrameCount: 0,
  });
  await settle();
  stops.length = 0;
  const played: number[] = [];
  const blocks = Math.ceil((passes * loopLength) / tempo / blockSize);
  for (let block = 0; block < blocks; block += 1) {
    played.push(...harness.process(new Float32Array(blockSize)));
  }
  await settle();
  return { centers: burstCenters(Float32Array.from(played)), stops };
};

type PassLoopback = {
  tempo: number;
  armSeconds?: number;
  heardUntilSeconds?: number;
  seekSeconds?: number;
};

const recordPass = async (loopback: PassLoopback) => {
  const { tempo, armSeconds, heardUntilSeconds, seekSeconds } = loopback;
  const harness = await createHarness([]);
  const events = listenToPasses(harness);
  const take = createTakeStream();
  harness.player.methods.setTempoRatio({ tempoRatio: tempo });
  harness.player.methods.setRange({ range: loop, repeat: 'cycle' });
  harness.player.methods.seek({ frameIndex: loop.fromFrame, revision: 1 });
  if (armSeconds === undefined) {
    startRecording(harness, take.notification);
  }
  harness.player.methods.play({
    revision: 1,
    latencyFrameCount: roundTrip,
    inputLatencyFrameCount: inputLatency,
  });
  await settle();
  const blockAt = (seconds: number) => Math.round((seconds * rate) / blockSize);
  const blocks = Math.ceil((3 * loopLength) / tempo / blockSize);
  const heardUntil = (heardUntilSeconds ?? Number.POSITIVE_INFINITY) * rate;
  const played: number[] = [];
  for (let block = 0; block < blocks; block += 1) {
    if (armSeconds !== undefined && block === blockAt(armSeconds)) {
      startRecording(harness, take.notification);
      await settle();
    }
    if (seekSeconds !== undefined && block === blockAt(seekSeconds)) {
      harness.player.methods.seek({ frameIndex: loop.fromFrame, revision: 2 });
      await settle();
    }
    const input = new Float32Array(blockSize);
    for (let index = 0; index < blockSize; index += 1) {
      const frame = block * blockSize + index;
      input[index] = frame < heardUntil ? (played[frame - roundTrip] ?? 0) : 0;
    }
    played.push(...harness.process(input));
  }
  harness.player.methods.flushRecording();
  await settle();
  const runs = toRuns(take.chunks).map((run) => ({
    startFrame: run.startFrame,
    frameCount: runSamples(run).length,
    centers: burstCenters(runSamples(run)).map(
      (center) => run.startFrame + center * tempo,
    ),
  }));
  return { runs, events };
};

describe('player loop', () => {
  it.each([1, 0.8, 1.25])(
    'plays the loop again and again at tempo %f',
    async (tempo) => {
      const passes = 3;
      const { centers } = await playLoop(tempo, passes);
      const expected = loopPlayCenters(tempo, passes);
      expect(centers).toHaveLength(expected.length);
      for (const [index, center] of centers.entries()) {
        expect(
          Math.abs(center - centers[0] - (expected[index] - expected[0])),
        ).toBeLessThan(timingTolerance);
      }
    },
  );

  it.each([1, 0.8, 1.25])(
    'plays only the start of the range once at tempo %f',
    async (tempo) => {
      const stopFrame = loop.fromFrame + loopLength / 2;
      const { centers, stops } = await playLoop(tempo, 2, 'once', stopFrame);
      expect(centers).toHaveLength(
        loopCenters.filter((center) => center < stopFrame).length,
      );
      expect(stops).toEqual([loop.fromFrame]);
    },
  );

  it.each([1, 0.8, 1.25])(
    'plays the range once and stops at its start at tempo %f',
    async (tempo) => {
      const { centers, stops } = await playLoop(tempo, 3, 'once');
      expect(centers).toHaveLength(loopCenters.length);
      expect(stops).toEqual([loop.fromFrame]);
    },
  );

  it.each([1, 0.8, 1.25])(
    'records the whole next pass when armed mid-pass at tempo %f',
    async (tempo) => {
      const { runs, events } = await recordPass({ tempo, armSeconds: 1 });
      expect(events).toEqual(['started', 'complete']);
      expect(runs).toHaveLength(1);
      const [run] = runs;
      expect(Math.abs(run.startFrame - loop.fromFrame)).toBeLessThanOrEqual(2);
      expect(
        Math.abs(run.frameCount - (loop.toFrame - loop.fromFrame) / tempo),
      ).toBeLessThanOrEqual(3);
      expect(run.centers).toHaveLength(loopCenters.length);
      for (const center of run.centers) {
        expect(Math.abs(nearestError(center, loopCenters))).toBeLessThan(
          timingTolerance,
        );
      }
    },
  );

  it('records the first pass when the try starts the song', async () => {
    const { runs, events } = await recordPass({
      tempo: 1,
      heardUntilSeconds: loopLength / rate,
    });
    expect(events).toEqual(['started', 'complete']);
    expect(runs).toHaveLength(1);
    expect(runs[0].centers).toHaveLength(loopCenters.length);
  });

  it('drops a try that a seek cuts short', async () => {
    const { events } = await recordPass({
      tempo: 1,
      armSeconds: 1,
      seekSeconds: 2.8,
    });
    expect(events).toEqual(['started', 'cancelled']);
  });
});
