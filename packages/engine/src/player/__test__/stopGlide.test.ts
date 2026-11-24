import { describe, expect, it, onTestFinished } from 'vitest';
import { rate } from './player.fixtures.js';
import { createSeam } from './seam.fixtures.js';

const outputLatency = 4800;

const open = async () => {
  const seam = await createSeam();
  onTestFinished(() => {
    seam.close();
  });
  seam.store.update((state) => {
    state.outputLatencyFrameCount = outputLatency;
  });
  return seam;
};

const shownAfter = async (
  seam: Awaited<ReturnType<typeof open>>,
  quanta: number,
) => {
  await seam.run(quanta);
  await seam.frame();
  return seam.store.get().frameIndex;
};

describe('Stop', () => {
  it('lets the cursor go on to the end of the sound and plays on from there', async () => {
    const seam = await open();
    await seam.player.play();
    await shownAfter(seam, 200);
    const atStop = seam.store.get().frameIndex;
    let soundEnd = Number.NaN;
    seam.onPostFromWorklet('setPlaying', (payload) => {
      if (payload instanceof Object && 'frameIndex' in payload) {
        soundEnd = Number(payload.frameIndex);
      }
    });
    await seam.player.stop();
    expect(seam.store.get().playing).toBe(false);
    expect(soundEnd - atStop).toBeGreaterThanOrEqual(outputLatency - 2 * 128);
    expect(seam.store.get().frameIndex).toBeLessThan(soundEnd);
    expect(await shownAfter(seam, 60)).toBe(soundEnd);
    expect(await shownAfter(seam, 60)).toBe(soundEnd);
    await seam.player.play();
    expect(await shownAfter(seam, 100)).toBeGreaterThan(soundEnd);
  });

  it('keeps the glide through a second Stop', async () => {
    const seam = await open();
    await seam.player.play();
    await shownAfter(seam, 200);
    const atStop = seam.store.get().frameIndex;
    await seam.player.stop();
    await seam.run(6);
    await seam.player.stop();
    const after = await shownAfter(seam, 60);
    expect(after - atStop).toBeGreaterThanOrEqual(outputLatency - 2 * 128);
    expect(await shownAfter(seam, 60)).toBe(after);
  });

  it('brings the cursor to where the sound ends after race 1', async () => {
    const seam = await open();
    seam.onPostToWorklet('play', () => {
      seam.player.seek(2 * rate, 'player');
    });
    await seam.player.play();
    await shownAfter(seam, 200);
    let soundEnd = Number.NaN;
    seam.onPostFromWorklet('setPlaying', (payload) => {
      if (payload instanceof Object && 'frameIndex' in payload) {
        soundEnd = Number(payload.frameIndex);
      }
    });
    await seam.player.stop();
    expect(await shownAfter(seam, 60)).toBe(soundEnd);
  });

  it('jumps nowhere back when a seek lands during the glide', async () => {
    const seam = await open();
    await seam.player.play();
    await shownAfter(seam, 200);
    await seam.player.stop();
    seam.player.seek(3 * rate, 'player');
    expect(await shownAfter(seam, 60)).toBe(3 * rate);
    expect(await shownAfter(seam, 60)).toBe(3 * rate);
  });
});
