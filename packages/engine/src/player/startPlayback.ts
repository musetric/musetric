import { type Store } from '../common/store.js';
import { type EngineDecoder } from '../decoder/index.js';
import { type EngineState } from '../state.js';
import { type EnginePlayback } from './playback.js';

export type CreateStartPlaybackOptions = {
  store: Store<EngineState>;
  getDecoder: () => EngineDecoder;
  getEnginePlayback: () => EnginePlayback;
};

export const createStartPlayback =
  (options: CreateStartPlaybackOptions) => async (): Promise<void> => {
    const { store, getDecoder, getEnginePlayback } = options;
    const currentState = store.get();
    if (
      currentState.playerCommandPending ||
      currentState.playing ||
      currentState.isSlave
    ) {
      return;
    }

    store.update((draft) => {
      draft.playing = true;
      draft.playerCommandPending = true;
    });
    try {
      getDecoder().sendPlayerPlay();
      await getEnginePlayback().play();
    } catch (error) {
      getDecoder().sendPlayerStop();
      store.update((draft) => {
        draft.playing = false;
      });
      throw error;
    } finally {
      store.update((draft) => {
        draft.playerCommandPending = false;
      });
    }
  };
