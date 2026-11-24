import { describe, expect, it, onTestFinished } from 'vitest';
import { blockSize, rate } from '../../player/__test__/player.fixtures.js';
import { createSeam, flush } from '../../player/__test__/seam.fixtures.js';
import { followSpectrogram } from './spectrogram.fixtures.js';

const heardAfterFrames = Math.round(0.12 * rate);
const halfScreenQuanta = 3;
const halfScreenFrames = halfScreenQuanta * blockSize;

const steps = (values: readonly number[]) =>
  values.slice(1).map((value, index) => value - values[index]);

describe('the Stop of a take', () => {
  it('plays out the sound already sent, the ruler and the picture with it', async () => {
    const seam = await createSeam({ heardAfterFrames });
    onTestFinished(() => {
      seam.close();
    });
    const readDrawn = followSpectrogram(seam);
    seam.player.seek(2 * rate, 'player');
    await seam.run(20);
    await seam.frame();
    const recording = seam.player.record(1);
    await flush();
    seam.microphone.open();
    await seam.run(Math.round((0.5 * rate) / blockSize));
    await recording;
    for (let screen = 0; screen < 30; screen += 1) {
      await seam.run(2 * halfScreenQuanta);
      await seam.frame();
    }
    const stoppedAt = seam.position.read();
    const stopping = seam.unclocked.stop();
    const shown: number[] = [stoppedAt];
    const drawn: number[] = [readDrawn()];
    for (let screen = 0; screen < 40; screen += 1) {
      await seam.run(halfScreenQuanta);
      drawn.push(readDrawn());
      await seam.run(halfScreenQuanta);
      await seam.frame();
      shown.push(seam.position.read());
      drawn.push(readDrawn());
    }
    await stopping;
    const end = shown.at(-1) ?? 0;
    expect(end - stoppedAt).toBeGreaterThan(heardAfterFrames / 2);
    expect(drawn.at(-1)).toBe(end);
    for (const step of steps(shown)) {
      expect(step).toBeGreaterThanOrEqual(0);
      expect(step).toBeLessThanOrEqual(3 * halfScreenFrames);
    }
    const moving = drawn.filter((frame) => frame < end);
    const drawnSteps = steps(moving);
    for (const step of drawnSteps) {
      expect(step).toBeGreaterThanOrEqual(0);
      expect(step).toBeLessThanOrEqual(2 * halfScreenFrames);
    }
    expect(drawnSteps.filter((step) => step === 0)).toHaveLength(0);
  });
});
