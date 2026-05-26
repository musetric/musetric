const quantum = 128;

const alignFrames = (frameCount: number) => {
  return Math.max(quantum, Math.ceil(frameCount / quantum) * quantum);
};

export type FrameIndexTracker = {
  advance: (outputFrameCount: number) => boolean;
  reset: () => void;
};

export const createFrameIndexTracker = (sampleRate: number) => {
  const interval = alignFrames(sampleRate / 120);
  let pendingFrameCount = 0;

  const ref: FrameIndexTracker = {
    advance: (outputFrameCount) => {
      pendingFrameCount += outputFrameCount;

      if (pendingFrameCount >= interval) {
        pendingFrameCount %= interval;
        return true;
      }

      return false;
    },
    reset: () => {
      pendingFrameCount = 0;
    },
  };

  return ref;
};
