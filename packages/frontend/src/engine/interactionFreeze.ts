import { engine } from './engine.js';

export type InteractionFreeze = {
  freeze: () => boolean;
  release: () => void;
};

export const createInteractionFreeze = (): InteractionFreeze => {
  let release: (() => void) | undefined = undefined;
  return {
    freeze: () => {
      if (release) return false;
      release = engine.player.hold();
      return true;
    },
    release: () => {
      release?.();
      release = undefined;
    },
  };
};
