import { engine } from './engine.js';

const createFreezeHolders = () => {
  let holders = 0;
  return {
    add: () => {
      holders += 1;
      if (holders === 1) {
        engine.player.setFrozen(true);
      }
    },
    remove: () => {
      holders -= 1;
      if (holders === 0) {
        engine.player.setFrozen(false);
      }
    },
  };
};

const freezeHolders = createFreezeHolders();

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
      freezeHolders.add();
      return true;
    },
    release: () => {
      if (!frozen) return;
      frozen = false;
      freezeHolders.remove();
    },
  };
};
