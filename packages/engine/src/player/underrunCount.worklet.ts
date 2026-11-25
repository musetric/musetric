const toleranceMs = 3;
const resetMs = 1000;

export type UnderrunCount = {
  observe: (frameCount: number) => void;
  read: () => number;
};

export const createUnderrunCount = (sampleRate: number): UnderrunCount => {
  const calls = { lastMs: 0, leadMs: 0, behindSinceMs: 0, count: 0 };
  const frameMs = 1000 / sampleRate;

  return {
    observe: (frameCount) => {
      const nowMs = Date.now();
      const gapMs = nowMs - calls.lastMs;
      calls.leadMs -= gapMs;
      const behind = calls.leadMs < -toleranceMs;
      const stuck =
        behind &&
        calls.behindSinceMs > 0 &&
        nowMs - calls.behindSinceMs > resetMs;
      if (calls.lastMs === 0 || gapMs > resetMs || stuck) {
        calls.leadMs = 0;
        calls.behindSinceMs = 0;
      } else if (!behind) {
        calls.leadMs = Math.max(calls.leadMs, 0);
        calls.behindSinceMs = 0;
      } else if (calls.behindSinceMs === 0) {
        calls.count += 1;
        calls.behindSinceMs = nowMs;
      }
      calls.leadMs += frameCount * frameMs;
      calls.lastMs = nowMs;
    },
    read: () => calls.count,
  };
};
