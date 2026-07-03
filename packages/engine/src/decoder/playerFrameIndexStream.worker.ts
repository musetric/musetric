import { createAnimationFrameLoop } from '@musetric/utils/cross/animationFrameLoop';
import { type Playhead, readPlayhead } from '../player/playhead.cross.js';

export type PlayerFrameIndexStreamOptions = {
  playhead: Playhead;
  onFrameIndex: (message: { frameIndex: number }) => void;
};

export type PlayerFrameIndexStream = {
  start: () => void;
  stop: () => void;
};

export const createPlayerFrameIndexStream = (
  options: PlayerFrameIndexStreamOptions,
): PlayerFrameIndexStream => {
  const { playhead, onFrameIndex } = options;
  let lastFrameIndex = -1;

  const loop = createAnimationFrameLoop(() => {
    const { frameIndex } = readPlayhead(playhead);
    if (frameIndex === lastFrameIndex) {
      return;
    }
    lastFrameIndex = frameIndex;
    onFrameIndex({ frameIndex });
  });

  return {
    start: () => {
      lastFrameIndex = -1;
      loop.start();
    },
    stop: () => {
      loop.stop();
    },
  };
};
