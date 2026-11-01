export type ClockStall = {
  observe: (contextTime: number, nowMs: number) => void;
  restart: (nowMs: number) => void;
  isStalled: (nowMs: number) => boolean;
};

export const createClockStall = (
  limitMs: number,
  contextTime: number,
  nowMs: number,
): ClockStall => {
  let advancedTime = contextTime;
  let advancedAtMs = nowMs;

  return {
    observe: (time, atMs) => {
      if (time !== advancedTime) {
        advancedTime = time;
        advancedAtMs = atMs;
      }
    },
    restart: (atMs) => {
      advancedAtMs = atMs;
    },
    isStalled: (atMs) => atMs - advancedAtMs >= limitMs,
  };
};
