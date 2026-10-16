import { type Metronome } from './metronome.worklet.js';
import { type MixTrackFrames } from './mixTrack.worklet.js';
import { type PlayerRange, type PlayerRangeRepeat } from './protocol.cross.js';

export const rangeFadeFrameCount = 256;

const ramp = (distance: number) =>
  distance < rangeFadeFrameCount
    ? Math.max(0, distance) / rangeFadeFrameCount
    : 1;

export type RangeFrames = MixTrackFrames & {
  range: PlayerRange;
  repeat: PlayerRangeRepeat;
  endFrame: number;
};

export const createRangeFrames = (
  range: PlayerRange,
  repeat: PlayerRangeRepeat,
  stopFrame?: number,
): RangeFrames => {
  const { fromFrame, toFrame } = range;
  const length = toFrame - fromFrame;
  const endFrame =
    repeat === 'once' && stopFrame !== undefined
      ? Math.min(toFrame, Math.max(fromFrame + 1, stopFrame))
      : toFrame;

  const songFrame =
    repeat === 'cycle'
      ? (frame: number) =>
          frame < toFrame ? frame : fromFrame + ((frame - fromFrame) % length)
      : (frame: number) => frame;

  const gain = (frame: number) => {
    if (frame >= endFrame) {
      return 0;
    }
    if (frame < fromFrame) {
      return 1;
    }
    return Math.min(ramp(frame - fromFrame), ramp(endFrame - frame));
  };

  return { range, repeat, endFrame, songFrame, gain };
};

export type ProcessRangeMetronomeOptions = {
  metronome: Metronome;
  range: RangeFrames | undefined;
  currentFrameIndex: number;
  nextFrameIndex: number;
  outputs: Float32Array[];
};

export const processRangeMetronome = (
  options: ProcessRangeMetronomeOptions,
): void => {
  const { metronome, range, currentFrameIndex, nextFrameIndex, outputs } =
    options;
  const outputFrameCount = outputs[0].length;
  if (!range) {
    metronome.process({
      oldFrameIndex: currentFrameIndex,
      newFrameIndex: nextFrameIndex,
      outputs,
      outputFrameCount,
    });
    return;
  }
  const { fromFrame, toFrame } = range.range;
  const oldFrameIndex = range.songFrame(currentFrameIndex);
  const newFrameIndex = range.songFrame(nextFrameIndex);
  metronome.process({
    oldFrameIndex,
    newFrameIndex: Math.min(newFrameIndex, toFrame),
    outputs,
    outputFrameCount,
    wrap:
      newFrameIndex < oldFrameIndex
        ? { endFrame: toFrame, startFrame: fromFrame }
        : undefined,
  });
};
