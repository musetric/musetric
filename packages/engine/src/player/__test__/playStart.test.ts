import { describe, expect, it, onTestFinished } from 'vitest';
import { blockSize, rate } from './player.fixtures.js';
import { createSeam } from './seam.fixtures.js';

const heardAfterFrames = Math.round(0.12 * rate);
const screenQuanta = 6;
const screenFrames = screenQuanta * blockSize;

describe('Play', () => {
  it('shows the start until the sound is heard, then follows the sound', async () => {
    const seam = await createSeam({ heardAfterFrames });
    onTestFinished(() => {
      seam.close();
    });
    const start = 2 * rate;
    seam.player.seek(start, 'player');
    await seam.run(20);
    await seam.frame();
    const playedAt = seam.contextFrame();
    await seam.player.play();
    const shown: { heardAtMost: number; frame: number }[] = [];
    for (let screen = 0; screen < 60; screen += 1) {
      await seam.run(screenQuanta);
      await seam.frame();
      shown.push({
        heardAtMost: Math.max(
          0,
          seam.contextFrame() - playedAt - heardAfterFrames,
        ),
        frame: seam.position.read() - start,
      });
    }
    for (const [index, entry] of shown.entries()) {
      expect(entry.frame).toBeLessThanOrEqual(entry.heardAtMost + screenFrames);
      expect(entry.frame).toBeGreaterThanOrEqual(shown[index - 1]?.frame ?? 0);
    }
    const last = shown.at(-1);
    expect(last?.frame).toBeGreaterThan((last?.heardAtMost ?? 0) - 0.05 * rate);
  });
});
