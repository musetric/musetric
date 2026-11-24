/* eslint-disable musetric/no-classes */
import { onTestFinished, vi } from 'vitest';
import { rate } from '../../player/__test__/player.fixtures.js';
import { type Seam } from '../../player/__test__/seam.fixtures.js';
import { createPlayhead } from '../../player/playhead.cross.js';
import { createEngineSpectrogram } from '../index.js';

type WorkerMessage = {
  type: string;
  payload: { trackProgress?: number; revision?: number };
};

export const followSpectrogram = (seam: Seam) => {
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
