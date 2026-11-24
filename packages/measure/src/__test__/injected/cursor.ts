import { isBuffering, isPlaying } from '@musetric/engine';
import { type PageHooks } from './hooks.js';
import { epochNow, wait } from './samples.js';

const playSeconds = 2.5;
const settleMs = 800;
const farSeekSeconds = 20;
const nearSeekSeconds = -3;
const playSeekDelaysMs = [0, 2, 5, 10, 20, 40];
const playSeekSeconds = 5;
const dragSteps = 45;
const dragStepMs = 16;
const dragStepSeconds = 0.04;
const loopOffsetSeconds = 10;
const loopSeconds = 2;
const loopTurns = 3.5;
const songSecondsNeeded = 40;

export type CursorEventKind =
  | 'play'
  | 'stop'
  | 'seek'
  | 'playSeek'
  | 'dragStart'
  | 'dragEnd'
  | 'loopStart'
  | 'loopEnd';

export type CursorOptions = {
  cycles: number;
  startSeconds: number;
};

export type CursorRun = {
  sampleRate: number;
  frameCount: number;
  frames: [epochMs: number, frameIndex: number, playing: number][];
  events: [epochMs: number, kind: CursorEventKind, frameIndex: number][];
  storeChanges: number[];
  buffering: [epochMs: number, buffering: number][];
  loop: { fromFrame: number; toFrame: number };
};

export const measureCursor = async (
  hooks: PageHooks,
  options: CursorOptions,
): Promise<CursorRun> => {
  const { engine } = hooks;
  const { player, store } = engine;
  const readPosition = () => engine.position.read();
  const { sampleRate } = engine.context;
  const frameCount = store.get().frameCount ?? 0;
  const startFrame = Math.round(options.startSeconds * sampleRate);
  if (frameCount < startFrame + songSecondsNeeded * sampleRate) {
    throw new Error('The song is too short for the cursor measurement');
  }
  const seconds = (value: number) => Math.round(value * sampleRate);
  const loop = {
    fromFrame: startFrame + seconds(loopOffsetSeconds),
    toFrame: startFrame + seconds(loopOffsetSeconds + loopSeconds),
  };
  const frames: CursorRun['frames'] = [];
  const events: CursorRun['events'] = [];
  const storeChanges: CursorRun['storeChanges'] = [];
  const buffering: CursorRun['buffering'] = [];
  const mark = (kind: CursorEventKind, frameIndex: number) => {
    events.push([epochNow(), kind, frameIndex]);
  };

  let sampling = true;
  const sample = () => {
    if (!sampling) {
      return;
    }
    frames.push([epochNow(), readPosition(), isPlaying(store.get()) ? 1 : 0]);
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
  const unsubscribeStore = store.subscribeState(() => {
    storeChanges.push(epochNow());
  });
  const unsubscribeBuffering = store.subscribe(isBuffering, (value) => {
    buffering.push([epochNow(), value ? 1 : 0]);
  });

  const stop = async () => {
    if (isPlaying(store.get())) {
      mark('stop', readPosition());
      await player.stop();
      await wait(settleMs);
    }
  };

  const play = async () => {
    mark('play', readPosition());
    await player.play();
  };

  const seek = (frameIndex: number) => {
    mark('seek', frameIndex);
    player.seek(frameIndex, 'player');
  };

  try {
    for (let cycle = 0; cycle < options.cycles; cycle += 1) {
      await stop();
      seek(startFrame);
      await wait(400);

      await play();
      await wait(playSeconds * 1000);
      await stop();

      await play();
      await wait(1000);
      seek(readPosition() + seconds(farSeekSeconds));
      await wait(1500);
      seek(readPosition() + seconds(nearSeekSeconds));
      await wait(1500);
      await stop();

      for (const delayMs of playSeekDelaysMs) {
        seek(startFrame);
        await wait(400);
        const target = startFrame + seconds(playSeekSeconds);
        const starting = player.play();
        await wait(delayMs);
        mark('playSeek', target);
        player.seek(target, 'player');
        await starting;
        await wait(1200);
        await stop();
      }

      seek(startFrame);
      await wait(400);
      await play();
      await wait(800);
      const dragFrom = readPosition();
      mark('dragStart', dragFrom);
      const release = player.hold();
      let dragTarget = dragFrom;
      for (let step = 1; step <= dragSteps; step += 1) {
        await wait(dragStepMs);
        dragTarget = dragFrom + seconds(step * dragStepSeconds);
        player.seek(dragTarget, 'playhead');
      }
      await wait(dragStepMs * 3);
      mark('dragEnd', dragTarget);
      release();
      await wait(1500);
      await stop();

      player.setRange(loop);
      mark('loopStart', loop.fromFrame);
      await player.playRange('cycle');
      await wait(loopTurns * loopSeconds * 1000);
      mark('loopEnd', readPosition());
      await stop();
      player.setRange(undefined);
      await wait(400);
    }
  } finally {
    if (isPlaying(store.get())) {
      await player.stop();
    }
    player.setRange(undefined);
    sampling = false;
    unsubscribeStore();
    unsubscribeBuffering();
  }

  return {
    sampleRate,
    frameCount,
    frames,
    events,
    storeChanges,
    buffering,
    loop,
  };
};
