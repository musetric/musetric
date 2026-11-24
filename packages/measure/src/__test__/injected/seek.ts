import { type EngineState, isPlaying } from '@musetric/engine';
import { type PageHooks } from './hooks.js';
import { epochNow, wait } from './samples.js';

const settleMs = 800;
const warmSeconds = 3;
const playSeconds = 2.5;
const farSeconds = 30;
const edgeSeconds = 10;

const createRandom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
};

export type SeekOptions = {
  seeks: number;
  seed: number;
  startSeconds: number;
  doubleMs: number;
};

const pickTargets = (
  options: SeekOptions,
  sampleRate: number,
  frameCount: number,
): number[] => {
  const low = edgeSeconds * sampleRate;
  const high = frameCount - edgeSeconds * sampleRate;
  const far = farSeconds * sampleRate;
  if (high - low < 3 * far) {
    throw new Error('The song is too short for the seek measurement');
  }
  const random = createRandom(options.seed);
  const count = options.doubleMs > 0 ? 2 * options.seeks : options.seeks;
  const targets: number[] = [];
  let previous = Math.round(options.startSeconds * sampleRate);
  while (targets.length < count) {
    const target = Math.round(low + random() * (high - low));
    if (Math.abs(target - previous) >= far) {
      targets.push(target);
      previous = target;
    }
  }
  return targets;
};

export type SeekRun = {
  sampleRate: number;
  frameCount: number;
  seeks: [epochMs: number, frameIndex: number][];
  decoys: [epochMs: number, frameIndex: number][];
  motion: [epochMs: number, motion: EngineState['motion']][];
  endedAt: number;
};

export const measureSeek = async (
  hooks: PageHooks,
  options: SeekOptions,
): Promise<SeekRun> => {
  const { engine } = hooks;
  const { player, store } = engine;
  const { sampleRate } = engine.context;
  const frameCount = store.get().frameCount ?? 0;
  const targets = pickTargets(options, sampleRate, frameCount);
  const seeks: SeekRun['seeks'] = [];
  const decoys: SeekRun['decoys'] = [];
  const motion: SeekRun['motion'] = [[epochNow(), store.get().motion]];
  const unsubscribe = store.subscribe(
    (state) => state.motion,
    (value) => {
      motion.push([epochNow(), value]);
    },
  );

  try {
    if (isPlaying(store.get())) {
      await player.stop();
      await wait(settleMs);
    }
    player.seek(Math.round(options.startSeconds * sampleRate), 'player');
    await wait(settleMs);
    await player.play();
    await wait(warmSeconds * 1000);
    for (let index = 0; index < options.seeks; index += 1) {
      if (options.doubleMs > 0) {
        const decoy = targets[2 * index];
        decoys.push([epochNow(), decoy]);
        player.seek(decoy, 'player');
        await wait(options.doubleMs);
      }
      const target = targets.at(options.doubleMs > 0 ? 2 * index + 1 : index);
      if (target === undefined) {
        throw new Error('The seek measurement ran out of targets');
      }
      seeks.push([epochNow(), target]);
      player.seek(target, 'player');
      await wait(playSeconds * 1000);
    }
  } finally {
    if (isPlaying(store.get())) {
      await player.stop();
    }
    unsubscribe();
  }

  return {
    sampleRate,
    frameCount,
    seeks,
    decoys,
    motion,
    endedAt: epochNow(),
  };
};
