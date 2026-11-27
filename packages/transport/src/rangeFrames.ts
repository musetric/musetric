import { type PlayheadLoop } from './playhead.js';

export type PlayerRangeRepeat = 'cycle' | 'once';

export type RangeFrames = {
  range: PlayheadLoop;
  repeat: PlayerRangeRepeat;
  endFrame: number;
  songFrame: (frame: number) => number;
};

export const createRangeFrames = (
  range: PlayheadLoop,
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

  return { range, repeat, endFrame, songFrame };
};

export const getTakeFrame = (
  range: RangeFrames | undefined,
  frame: number,
  recording: boolean,
): number | undefined => {
  const songFrame = range ? range.songFrame(frame) : frame;
  if (recording || (range && songFrame >= range.endFrame)) {
    return undefined;
  }
  return songFrame;
};
