import { engine } from './engine.js';

export type InteractionFreeze = {
  freeze: () => boolean;
  release: () => void;
};

export const createInteractionFreeze = (): InteractionFreeze => {
  let frozen = false;
  return {
    freeze: () => {
      if (frozen) return false;
      frozen = true;
      engine.player.setFrozen(true);
      return true;
    },
    release: () => {
      if (!frozen) return;
      frozen = false;
      engine.player.setFrozen(false);
    },
  };
};
