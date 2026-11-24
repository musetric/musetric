import { describe, expect, it, onTestFinished } from 'vitest';
import { rate } from './player.fixtures.js';
import { createSeam, flush, type Seam } from './seam.fixtures.js';

const quantaOfSeconds = (seconds: number) => Math.round((seconds * rate) / 128);

const open = async () => {
  const seam = await createSeam();
  onTestFinished(() => {
    seam.close();
  });
  return seam;
};

const shownAfter = async (current: Seam, seconds: number) => {
  await current.run(quantaOfSeconds(seconds));
  await current.frame();
  return current.position.read();
};

describe('the seam of the player', () => {
  it('moves the cursor while the song plays and holds it on Stop', async () => {
    const current = await open();
    await current.player.play();
    const first = await shownAfter(current, 0.5);
    const second = await shownAfter(current, 0.5);
    expect(first).toBeGreaterThan(0);
    expect(second - first).toBeGreaterThan(0.4 * rate);
    await current.player.stop();
    const stopped = current.position.read();
    expect(await shownAfter(current, 0.5)).toBe(stopped);
    expect(current.store.get().playing).toBe(false);
  });

  it.fails(
    'race 1: moves the cursor after a seek within the round trip of Play',
    async () => {
      const current = await open();
      const target = 2 * rate;
      current.onPostToWorklet('play', () => {
        current.player.seek(target, 'player');
      });
      await current.player.play();
      const first = await shownAfter(current, 0.5);
      const second = await shownAfter(current, 0.5);
      expect(current.store.get().playing).toBe(true);
      expect(first).toBeGreaterThanOrEqual(target);
      expect(second).toBeGreaterThan(first);
    },
  );

  it.fails(
    'race 2: stops playing when a range played once ends across a seek',
    async () => {
      const current = await open();
      current.player.setRange({ fromFrame: 0, toFrame: rate });
      await current.player.playRange('once');
      current.onPostFromWorklet('setPlaying', (payload) => {
        if (
          payload instanceof Object &&
          'playing' in payload &&
          payload.playing === false
        ) {
          current.player.seek(rate / 2, 'player');
        }
      });
      await shownAfter(current, 1.5);
      await flush();
      expect(current.store.get().playing).toBe(false);
    },
  );

  it.fails('race 5: keeps a Stop pressed while a take prepares', async () => {
    const current = await open();
    const recording = current.player.record(1);
    await flush();
    expect(current.store.get().recording).toBe(true);
    await current.player.stop();
    current.microphone.open();
    await shownAfter(current, 0.5);
    await recording;
    await shownAfter(current, 0.5);
    expect(current.store.get().recording).toBe(false);
  });
});

type FuzzStep = { command: string; playing: boolean; frames: number[] };

const findBrokenInvariant = (steps: readonly FuzzStep[]) => {
  for (const [index, step] of steps.entries()) {
    const { command, playing, frames } = step;
    if (command === 'play' && !playing) {
      return `step ${index}: Play did not play`;
    }
    if (
      command === 'stop' &&
      (playing || frames.some((frame) => frame !== frames[0]))
    ) {
      return `step ${index}: Stop did not hold the cursor`;
    }
    if (
      playing &&
      frames.some((frame, at) => at > 0 && frame < frames[at - 1])
    ) {
      return `step ${index}: the cursor stepped back while playing`;
    }
  }
  return undefined;
};

const createRandom = (seed: number) => {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
};

const fuzzCommands = ['play', 'stop', 'seek', 'wait'] as const;

describe('a seeded fuzz of the commands of the player', () => {
  it('tells a broken invariant', () => {
    expect(
      findBrokenInvariant([
        { command: 'play', playing: true, frames: [100, 200, 150] },
      ]),
    ).toBe('step 0: the cursor stepped back while playing');
    expect(
      findBrokenInvariant([
        { command: 'stop', playing: false, frames: [100, 110] },
      ]),
    ).toBe('step 0: Stop did not hold the cursor');
    expect(
      findBrokenInvariant([{ command: 'play', playing: false, frames: [0] }]),
    ).toBe('step 0: Play did not play');
  });

  it.each([1, 2, 3])(
    'keeps its invariants over commands one at a time, seed %i',
    async (seed) => {
      const current = await open();
      const random = createRandom(seed);
      const steps: FuzzStep[] = [];
      for (let step = 0; step < 30; step += 1) {
        const command =
          fuzzCommands[Math.floor(random() * fuzzCommands.length)];
        if (command === 'play') {
          await current.player.play();
        } else if (command === 'stop') {
          await current.player.stop();
        } else if (command === 'seek') {
          current.player.seek(Math.round(random() * 5 * rate), 'player');
        }
        await flush();
        const frames: number[] = [];
        for (let frame = 0; frame < 4; frame += 1) {
          frames.push(await shownAfter(current, 0.025));
        }
        steps.push({ command, playing: current.store.get().playing, frames });
      }
      expect(steps.filter((step) => step.playing).length).toBeGreaterThan(5);
      expect(findBrokenInvariant(steps)).toBeUndefined();
    },
    30000,
  );
});
