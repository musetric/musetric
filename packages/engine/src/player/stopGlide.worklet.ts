import { type PlayheadValue } from './playhead.cross.js';
import { type PlayheadPublisher } from './playhead.worklet.js';

export type StopGlide = {
  start: (
    line: PlayheadValue,
    soundEndFrame: number,
    stopContextFrame: number,
  ) => number | undefined;
  advance: (contextFrame: number) => void;
  clear: () => void;
  active: () => boolean;
};

type Glide = {
  line: PlayheadValue;
  stopContextFrame: number;
  endFrame: number;
};

export const createStopGlide = (
  playhead: PlayheadPublisher,
  publishHeld: () => void,
): StopGlide => {
  let glide: Glide | undefined = undefined;

  return {
    start: (line, soundEndFrame, stopContextFrame) => {
      const endFrame = Math.min(line.endFrame, soundEndFrame);
      if (line.rate <= 0 || endFrame <= line.frameIndex) {
        glide = undefined;
        return undefined;
      }
      glide = { line: { ...line, endFrame }, stopContextFrame, endFrame };
      playhead.publishNow(glide.line);
      return endFrame;
    },
    advance: (contextFrame) => {
      if (!glide) {
        return;
      }
      const { line, stopContextFrame, endFrame } = glide;
      const heardContextFrame =
        line.contextFrame + (contextFrame - stopContextFrame);
      const frameIndex =
        line.frameIndex + (heardContextFrame - line.contextFrame) * line.rate;
      if (frameIndex >= endFrame) {
        glide = undefined;
        publishHeld();
        return;
      }
      playhead.publish({
        ...line,
        frameIndex,
        contextFrame: heardContextFrame,
      });
    },
    clear: () => {
      glide = undefined;
    },
    active: () => glide !== undefined,
  };
};
