import { describe, expect, it, onTestFinished } from 'vitest';
import { isPlaying, isRecording } from '../../state.js';
import { type PlayerFault } from '../guardedPlayer.worklet.js';
import { rate } from './player.fixtures.js';
import { createSeam, flush, type Seam } from './seam.fixtures.js';

const open = async () => {
  const seam = await createSeam();
  onTestFinished(() => {
    seam.close();
  });
  return seam;
};

const quantaOfSeconds = (seconds: number) => Math.round((seconds * rate) / 128);

const faults: PlayerFault[] = ['caught', 'uncaught'];

const startTake = async (seam: Seam) => {
  const recording = seam.player.record(1);
  await flush();
  seam.microphone.open();
  await seam.run(quantaOfSeconds(0.5));
  await recording;
};

const expectFailed = (seam: Seam) => {
  const state = seam.store.get();
  expect(state.statuses.player).toBe('error');
  expect(state.motion).toBe('stopped');
  expect(state.session).toBe('idle');
  expect(isPlaying(state)).toBe(false);
  expect(isRecording(state)).toBe(false);
};

describe('a failure of the player on the audio thread', () => {
  it.each(faults)(
    'stops playing and holds the cursor on a %s fault',
    async (fault) => {
      const seam = await open();
      await seam.player.play();
      await seam.run(quantaOfSeconds(0.5));
      expect(seam.store.get().statuses.player).toBe('success');
      seam.injectFault(fault);
      await seam.run(1);
      await seam.frame();
      expectFailed(seam);
      const held = seam.position.read();
      expect(held).toBeGreaterThan(0.4 * rate);
      await seam.run(quantaOfSeconds(0.5));
      await seam.frame();
      expect(seam.position.read()).toBe(held);
    },
  );

  it.each(faults)(
    'ends a take at once with what reached the host on a %s fault',
    async (fault) => {
      const seam = await open();
      await startTake(seam);
      expect(seam.store.get().take).toBe('recording');
      const reached = seam.hostFrames();
      expect(reached).toBeGreaterThan(0.4 * rate);
      seam.injectFault(fault);
      await seam.run(1);
      expect(seam.host).toEqual(['recording.start', 'recording.finish']);
      expectFailed(seam);
      await seam.run(quantaOfSeconds(0.5));
      expect(seam.hostFrames()).toBe(reached);
    },
  );

  it('fails on an error in a handler of the worklet', async () => {
    const seam = await open();
    await seam.player.play();
    await seam.run(quantaOfSeconds(0.2));
    seam.postToWorklet({ type: 'setOutputClock', payload: undefined });
    await seam.run(1);
    expect(seam.fromWorklet).toContain('failed');
    expectFailed(seam);
  });

  it('answers Play and Record at once after a failure', async () => {
    const seam = await open();
    seam.injectFault('caught');
    await seam.run(1);
    await seam.player.play();
    expectFailed(seam);
    await seam.player.record(1);
    expectFailed(seam);
    expect(seam.host).toEqual([]);
    expect(seam.toWorklet).not.toContain('play');
  });
});
