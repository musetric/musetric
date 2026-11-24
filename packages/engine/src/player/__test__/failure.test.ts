import { describe, expect, it, onTestFinished } from 'vitest';
import { isPlaying, isRecording, isTransportBusy } from '../../state.js';
import { type PlayerFault } from '../guardedPlayer.worklet.js';
import { rate } from './player.fixtures.js';
import {
  createSeam,
  type CreateSeamOptions,
  flush,
  type Seam,
} from './seam.fixtures.js';

const open = async (options?: CreateSeamOptions) => {
  const seam = await createSeam(options);
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

const expectSettled = async (seam: Seam) => {
  expectFailed(seam);
  expect(isTransportBusy(seam.store.get())).toBe(false);
  await seam.player.stop();
  expect(isTransportBusy(seam.store.get())).toBe(false);
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

const readCommand = (payload: unknown) =>
  payload instanceof Object && 'command' in payload ? payload.command : 0;

describe('a failure of the player while a command waits for the worklet', () => {
  it('settles a Play that waits for its ack', async () => {
    const seam = await open();
    const unsubscribe = seam.store.subscribe(
      (state) => state.session,
      (session) => {
        if (session === 'starting') {
          seam.injectFault('caught');
        }
      },
    );
    onTestFinished(unsubscribe);
    await seam.player.play();
    await expectSettled(seam);
  });

  it('settles a Stop that waits for its ack', async () => {
    const seam = await open();
    await seam.player.play();
    await seam.run(quantaOfSeconds(0.2));
    seam.onPostToWorklet('stop', () => {
      seam.injectFault('caught');
    });
    await seam.player.stop();
    await expectSettled(seam);
  });

  it('settles a take that arms', async () => {
    const seam = await open();
    const recording = seam.player.record(1);
    await flush();
    expect(seam.store.get().take).toBe('arming');
    seam.injectFault('caught');
    seam.microphone.open();
    await seam.run(2);
    await recording;
    await seam.run(2);
    expect(seam.host).toEqual(['recording.start', 'recording.finish']);
    await expectSettled(seam);
  });

  it('settles a take that drains', async () => {
    const seam = await open({
      before: (store) => {
        store.update((state) => {
          state.latencyCorrectionFrameCount = rate / 20;
        });
      },
    });
    await startTake(seam);
    seam.onPostToWorklet('flushRecording', () => {
      seam.injectFault('caught');
    });
    const draining = seam.player.stopRecording();
    await flush();
    expect(seam.store.get().take).toBe('draining');
    await seam.run(2);
    expect(seam.host).toEqual(['recording.start', 'recording.finish']);
    await draining;
    await expectSettled(seam);
  });

  it('boots past a worklet that fails while it boots', async () => {
    const seam = await open({ bootFault: true });
    expect(seam.fromWorklet).toContain('failed');
    await seam.player.play();
    await expectSettled(seam);
  });

  it('ignores what the worklet sent before its failure reached the page', async () => {
    const seam = await open();
    let command = 0;
    seam.onPostToWorklet('play', (payload) => {
      command = Number(readCommand(payload));
    });
    await seam.player.play();
    await seam.run(quantaOfSeconds(0.2));
    seam.injectFault('uncaught');
    await seam.run(1);
    expectFailed(seam);
    await seam.deliverFromWorklet({ type: 'booted' });
    await seam.deliverFromWorklet({
      type: 'setPlaying',
      payload: {
        command,
        playing: true,
        motion: 'rolling',
        frameIndex: 0,
        revision: seam.store.get().seekEvent.revision,
      },
    });
    expectFailed(seam);
  });
});
