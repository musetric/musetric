import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activeRecording,
  createTakeHost,
  flushPorts,
  type TakeHost,
} from './takeHost.js';

vi.mock('../../audioRequest/audioRequest.worker.js', () => ({
  getRecordingList: async () =>
    Promise.resolve({ recordings: [activeRecording] }),
  getRecordingPieces: async () => new Promise(() => undefined),
  getRecordingPiece: async () => new Promise(() => undefined),
}));

const refusals = (host: TakeHost) =>
  host.received
    .filter((message) => message.type === 'takeRefused')
    .map((message) => message.payload);

const finishedTakes = (host: TakeHost) =>
  host.received
    .filter((message) => message.type === 'recordingStreamFinished')
    .map((message) => message.payload?.takeId);

const createRandom = (seed: number) => {
  let state = seed;
  return (count: number) => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return Math.floor((((mixed ^ (mixed >>> 14)) >>> 0) / 2 ** 32) * count);
  };
};

type Play = {
  host: TakeHost;
  pick: (count: number) => number;
  takeIds: string[];
  taken: number;
  recording: boolean;
};

type Move = (play: Play) => Promise<void> | void;

const singOrRecord: Move = async (play) => {
  if (play.recording) {
    play.host.sing(1 + play.pick(600));
    return;
  }
  const takeId = play.takeIds.at(play.taken);
  if (takeId !== undefined) {
    await play.host.record(takeId);
    play.taken += 1;
    play.recording = true;
  }
};

const moves: Move[] = [
  singOrRecord,
  singOrRecord,
  singOrRecord,
  singOrRecord,
  (play) => {
    if (play.recording) {
      play.host.seek(play.pick(3) * 1000);
    }
  },
  async (play) => {
    if (play.recording && play.pick(3) === 0) {
      await play.host.stop();
      play.recording = false;
    }
  },
  (play) => {
    if (play.host.connected()) {
      play.host.serve(1 + play.pick(20));
    }
  },
  async (play) => {
    if (play.host.connected()) {
      await play.host.answer(1 + play.pick(3));
    }
  },
  async (play) => {
    if (!play.host.connected()) {
      await play.host.reconnect();
    } else if (play.pick(3) === 0) {
      await play.host.drop();
    }
  },
  async (play) => {
    await vi.advanceTimersByTimeAsync(play.pick(3000));
  },
];

const playOrders = async (seed: number, takeIds: string[]) => {
  const play: Play = {
    host: await createTakeHost(),
    pick: createRandom(seed),
    takeIds,
    taken: 0,
    recording: false,
  };
  const { host } = play;
  for (let step = 0; step < 100; step += 1) {
    await moves[play.pick(moves.length)](play);
    await flushPorts();
  }
  await host.stop();
  for (let round = 0; round < 3; round += 1) {
    if (!host.connected()) {
      await host.reconnect();
    }
    await host.settle();
    await vi.advanceTimersByTimeAsync(6000);
  }
  return { host, taken: takeIds.slice(0, play.taken) };
};

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('take delivery', () => {
  it('delivers a take the host accepts at once', async () => {
    const host = await createTakeHost();
    await host.record('take');
    await host.settle();
    host.sing(100);
    await host.stop();
    await host.settle();

    expect(host.stored.get('take')).toEqual(host.sung('take'));
    expect(host.sent().at(-1)).toBe('recording.finish');
    expect(finishedTakes(host)).toEqual(['take']);
  });

  it('keeps a take until the host accepts it', async () => {
    const host = await createTakeHost();
    await host.record('take');
    host.sing(100);
    await host.stop();
    await vi.advanceTimersByTimeAsync(10000);
    await host.settle();

    expect(host.stored.get('take')).toEqual(host.sung('take'));
    expect(host.sent().at(-1)).toBe('recording.finish');
    expect(refusals(host)).toEqual([]);
  });

  it('sends the frames it holds when the worklet never drains', async () => {
    const host = await createTakeHost();
    await host.record('take');
    await host.settle();
    host.sing(60);
    await flushPorts();
    await host.finish();
    await host.settle();

    expect(host.stored.get('take')).toEqual(host.sung('take'));
    expect(host.sent().at(-1)).toBe('recording.finish');
  });

  it('delivers every frame once across a drop mid-take', async () => {
    const host = await createTakeHost();
    await host.record('take');
    await host.settle();
    host.sing(1500);
    await flushPorts();
    host.serve(10);
    await host.drop();
    host.sing(1000);
    await flushPorts();
    await host.reconnect();
    await host.settle();
    host.seek(300);
    host.sing(700);
    await host.stop();
    await host.settle();

    expect(host.sung('take')).toHaveLength(2);
    expect(host.stored.get('take')).toEqual(host.sung('take'));
    expect(host.faults).toEqual([]);
    expect(refusals(host)).toEqual([]);
  });

  it('delivers every frame once across a drop during the finish', async () => {
    const host = await createTakeHost();
    await host.record('take');
    await host.settle();
    host.sing(2500);
    await host.stop();
    host.serve(5);
    await host.drop();

    expect(finishedTakes(host)).toEqual(['take']);

    await host.reconnect();
    await host.settle();

    expect(host.stored.get('take')).toEqual(host.sung('take'));
    expect(host.faults).toEqual([]);
    expect(refusals(host)).toEqual([]);
  });

  it('stops a take the host refuses at once', async () => {
    const host = await createTakeHost();
    host.refuseNextStart();
    await host.record('take');
    await host.settle();

    expect(refusals(host)).toEqual([{ takeId: 'take', reason: 'busy' }]);

    host.sing(100);
    await host.stop();
    await host.settle();

    expect(host.sent()).not.toContain('packet');
    expect(finishedTakes(host)).toEqual(['take']);
  });

  it('stops a take the host ended and keeps what reached it', async () => {
    const host = await createTakeHost();
    await host.record('take');
    await host.settle();
    host.sing(1000);
    await flushPorts();
    await host.settle();
    await host.drop(true);
    host.sing(500);
    await flushPorts();
    const sentBefore = host.sent().length;
    await host.reconnect();
    await host.settle();

    expect(refusals(host)).toEqual([{ takeId: 'take', reason: 'ended' }]);
    expect(host.stored.get('take')).toEqual([
      { startFrame: 0, samples: host.sung('take')[0].samples.slice(0, 1000) },
    ]);
    expect(host.sent().slice(sentBefore)).not.toContain('packet');
  });
});

describe('take orders', () => {
  it('lands every frame once in the take of its id', async () => {
    for (let seed = 1; seed <= 120; seed += 1) {
      const { host, taken } = await playOrders(seed, ['first', 'second']);
      for (const takeId of taken) {
        expect(host.stored.get(takeId), `seed ${seed}, ${takeId}`).toEqual(
          host.sung(takeId),
        );
      }
      expect(finishedTakes(host), `seed ${seed}`).toHaveLength(taken.length);
      expect(finishedTakes(host)).toEqual(expect.arrayContaining(taken));
      expect(host.faults, `seed ${seed}`).toEqual([]);
      expect(refusals(host), `seed ${seed}`).toEqual([]);
      await host.close();
      vi.unstubAllGlobals();
    }
  });
});
