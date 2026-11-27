import { type PlayheadValue } from './playhead.cross.js';
import { type PlayheadPublisher } from './playhead.worklet.js';

export type StopGlide = {
  start: (
    line: PlayheadValue,
    soundEndFrame: number,
    stopContextFrame: number,
  ) => number | undefined;
  advance: (contextFrame: number) => void;
  publishPlaying: (contextFrame: number) => void;
  seek: (frameIndex: number, revision: number) => void;
  clear: () => void;
  active: () => boolean;
};

type Glide = {
  line: PlayheadValue;
  moving: PlayheadValue;
  stopContextFrame: number;
};

export const createStopGlide = (
  playhead: PlayheadPublisher,
  publishHeld: () => void,
  publishHeard: () => void,
): StopGlide => {
  let glide: Glide | undefined = undefined;

  const advance = (contextFrame: number) => {
    if (!glide) {
      return;
    }
    const { line, moving, stopContextFrame } = glide;
    const heardContextFrame =
      line.contextFrame + (contextFrame - stopContextFrame);
    const frameIndex =
      line.frameIndex + (heardContextFrame - line.contextFrame) * line.rate;
    if (frameIndex >= line.endFrame) {
      glide = undefined;
      // eslint-disable-next-line musetric/no-audio-thread-allocations -- once, when the glide after Stop ends
      publishHeld();
      return;
    }
    moving.frameIndex = frameIndex;
    moving.contextFrame = heardContextFrame;
    playhead.publish(moving);
  };

  return {
    start: (line, soundEndFrame, stopContextFrame) => {
      const endFrame = Math.min(line.endFrame, soundEndFrame);
      if (line.rate <= 0 || endFrame <= line.frameIndex) {
        glide = undefined;
        return undefined;
      }
      glide = {
        line: { ...line, endFrame },
        moving: { ...line, endFrame },
        stopContextFrame,
      };
      playhead.publishNow(glide.line);
      return endFrame;
    },
    advance,
    publishPlaying: (contextFrame) => {
      if (glide) {
        advance(contextFrame);
        return;
      }
      publishHeard();
    },
    seek: (frameIndex, revision) => {
      if (
        glide?.line.endFrame !== frameIndex ||
        glide.line.revision !== revision
      ) {
        glide = undefined;
      }
    },
    clear: () => {
      glide = undefined;
    },
    active: () => glide !== undefined,
  };
};
