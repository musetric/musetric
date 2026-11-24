import { type Store } from '../common/store.js';
import { type EngineState } from '../state.js';
import { type EnginePlayback } from './playback.js';

export type CreateStartPlaybackOptions = {
  store: Store<EngineState>;
  getEnginePlayback: () => EnginePlayback;
};

export const createStartPlayback =
  (options: CreateStartPlaybackOptions) => async (): Promise<void> => {
    const { store, getEnginePlayback } = options;
    const currentState = store.get();
    if (currentState.playerCommandPending || currentState.playing) {
      return;
    }

    store.update((draft) => {
      draft.playing = true;
      draft.playerCommandPending = true;
    });
    try {
      await getEnginePlayback().play();
    } catch (error) {
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
