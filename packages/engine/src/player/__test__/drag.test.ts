import { describe, expect, it, onTestFinished } from 'vitest';
import { rate } from './player.fixtures.js';
import { createSeam } from './seam.fixtures.js';

const open = async () => {
  const seam = await createSeam();
  onTestFinished(() => {
    seam.close();
  });
  return seam;
};

const shownAfter = async (
  seam: Awaited<ReturnType<typeof open>>,
  quanta: number,
) => {
  await seam.run(quanta);
  await seam.frame();
  return seam.position.read();
};

describe('a drag of the cursor', () => {
  it('moves the shown cursor alone and seeks the player once on release', async () => {
    const seam = await open();
    await seam.player.play();
    await shownAfter(seam, 40);
    const release = seam.player.hold();
    const seeksBefore = seam.toWorklet.filter((type) => type === 'seek').length;
    const hostBefore = seam.host.length;
    const targets = Array.from({ length: 20 }, (_, step) => rate + step * 2400);
    for (const target of targets) {
      seam.player.seek(target, 'playhead');
      expect(await shownAfter(seam, 6)).toBe(target);
    }
    expect(seam.toWorklet.filter((type) => type === 'seek')).toHaveLength(
      seeksBefore,
    );
    expect(seam.host).toHaveLength(hostBefore);
    release();
    await shownAfter(seam, 6);
    expect(seam.toWorklet.filter((type) => type === 'seek')).toHaveLength(
      seeksBefore + 1,
    );
    expect(seam.host).toHaveLength(hostBefore);
    const released = targets.at(-1) ?? 0;
    const first = await shownAfter(seam, 40);
    const second = await shownAfter(seam, 40);
    expect(first).toBeGreaterThanOrEqual(released);
    expect(second).toBeGreaterThan(first);
  });

  it('holds the cursor until the last of two holds is released', async () => {
    const seam = await open();
    await seam.player.play();
    await shownAfter(seam, 40);
    const releaseFirst = seam.player.hold();
    const releaseSecond = seam.player.hold();
    const seeksBefore = seam.toWorklet.filter((type) => type === 'seek').length;
    seam.player.seek(2 * rate, 'playhead');
    releaseFirst();
    releaseFirst();
    await shownAfter(seam, 6);
    expect(seam.store.get().frozen).toBe(true);
    await shownAfter(seam, 6);
    expect(seam.store.get().motion).toBe('held');
    expect(seam.toWorklet.filter((type) => type === 'seek')).toHaveLength(
      seeksBefore,
    );
    releaseSecond();
    await shownAfter(seam, 6);
    expect(seam.store.get().frozen).toBe(false);
    await shownAfter(seam, 6);
    expect(seam.store.get().motion).toBe('rolling');
    expect(seam.toWorklet.filter((type) => type === 'seek')).toHaveLength(
      seeksBefore + 1,
    );
  });
});
