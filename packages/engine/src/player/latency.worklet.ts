import { type HeardPosition } from '@musetric/transport';
import { type LatencyFrameCounts } from './recording.worklet.js';

export type WorkletLatency = {
  apply: (counts: LatencyFrameCounts) => void;
  getInputFrameCount: () => number;
  getOutputFrameCount: () => number;
};

export const createWorkletLatency = (
  position: HeardPosition,
  isPlaying: () => boolean,
): WorkletLatency => {
  let inputFrameCount = 0;
  let outputFrameCount = 0;
  return {
    apply: (counts) => {
      inputFrameCount = Math.max(0, counts.inputLatencyFrameCount);
      outputFrameCount = Math.max(
        0,
        Math.max(0, counts.latencyFrameCount) - inputFrameCount,
      );
      position.setOutputLatency(outputFrameCount);
      if (isPlaying()) {
        position.refresh();
      }
    },
    getInputFrameCount: () => inputFrameCount,
    getOutputFrameCount: () => outputFrameCount,
  };
};
