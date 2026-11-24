import { type PlayerMotion } from './protocol.cross.js';

export type CreateMotionOptions = {
  isPlaying: () => boolean;
  isHeld: () => boolean;
  isMounted: () => boolean;
};

export type Motion = {
  settle: () => PlayerMotion;
  moveTo: (next: 'rolling' | 'buffering', report: () => void) => void;
};

export const createMotion = (options: CreateMotionOptions): Motion => {
  let motion: PlayerMotion = 'stopped';
  return {
    settle: () => {
      if (!options.isPlaying() || !options.isMounted()) {
        motion = 'stopped';
      } else if (options.isHeld()) {
        motion = 'held';
      } else if (motion !== 'buffering') {
        motion = 'rolling';
      }
      return motion;
    },
    moveTo: (next, report) => {
      if (motion !== next) {
        motion = next;
        report();
      }
    },
  };
};
