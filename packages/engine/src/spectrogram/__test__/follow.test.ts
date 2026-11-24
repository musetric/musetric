import { describe, expect, it, onTestFinished } from 'vitest';
import { rate } from '../../player/__test__/player.fixtures.js';
import { createSeam, type Seam } from '../../player/__test__/seam.fixtures.js';
import { followSpectrogram } from './spectrogram.fixtures.js';

const open = async () => {
  const seam = await createSeam();
  onTestFinished(() => {
    seam.close();
  });
  return seam;
};

const drawnAfter = async (seam: Seam, readDrawn: () => number) => {
  await seam.run(6);
  await seam.frame();
  return readDrawn();
};

describe('the spectrogram during a drag while the song plays', () => {
  it('draws the dragged position, then plays on from where it was released', async () => {
    const seam = await open();
    const readDrawn = followSpectrogram(seam);
    await seam.player.play();
    await seam.run(40);
    const release = seam.player.hold();
    const targets = Array.from({ length: 10 }, (_, step) => rate + step * 4800);
    for (const target of targets) {
      seam.player.seek(target, 'spectrogramVisualization');
      expect(await drawnAfter(seam, readDrawn)).toBe(target);
    }
    release();
    const released = targets.at(-1) ?? 0;
    const drawn: number[] = [];
    for (let frame = 0; frame < 20; frame += 1) {
      drawn.push(await drawnAfter(seam, readDrawn));
    }
    expect(Math.min(...drawn)).toBeGreaterThanOrEqual(released);
    expect(drawn.at(-1)).toBeGreaterThan(released);
  });
});
