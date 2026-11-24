/* eslint-disable musetric/no-classes */
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { rate } from '../../player/__test__/player.fixtures.js';
import { createSeam, type Seam } from '../../player/__test__/seam.fixtures.js';
import { createPlayhead } from '../../player/playhead.cross.js';
import { createEngineSpectrogram } from '../index.js';

const open = async () => {
  const seam = await createSeam();
  onTestFinished(() => {
    seam.close();
  });
  return seam;
};

type WorkerMessage = {
  type: string;
  payload: { trackProgress?: number; revision?: number };
};

const followSpectrogram = (seam: Seam) => {
  const playhead = createPlayhead(seam.spectrogramPlayheadPort, rate);
  const frameCount = seam.store.get().frameCount ?? 0;
  class FakeWorker {
    onmessage = undefined;
    onerror = undefined;
    postMessage(message: WorkerMessage) {
      const { trackProgress, revision } = message.payload;
      if (
        message.type === 'setTrackProgress' &&
        trackProgress !== undefined &&
        revision !== undefined
      ) {
        playhead.writeFrameIndex(
          Math.round(trackProgress * frameCount),
          revision,
        );
      }
    }
  }
  vi.stubGlobal('Worker', FakeWorker);
  const unused = new MessageChannel();
  onTestFinished(() => {
    unused.port1.close();
  });
  createEngineSpectrogram({
    store: seam.store,
    sampleRate: rate,
    decoderPort: unused.port1,
    playheadPort: unused.port2,
    position: seam.position,
  });
  return () => playhead.readFrameIndex();
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
