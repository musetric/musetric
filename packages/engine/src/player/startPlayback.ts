import { type Store } from '../common/store.js';
import { type EngineState, isPlaying } from '../state.js';
import { type EnginePlayback } from './playback.js';
import { type EngineSessionMachine } from './session.js';

export type CreateStartPlaybackOptions = {
  store: Store<EngineState>;
  session: EngineSessionMachine;
  getEnginePlayback: () => EnginePlayback;
};

export const createStartPlayback =
  (options: CreateStartPlaybackOptions) => async (): Promise<void> => {
    const { store, session, getEnginePlayback } = options;
    if (isPlaying(store.get())) {
      return;
    }

    session.beginPlay();
    try {
      if (await getEnginePlayback().play()) {
        session.settlePlay();
      } else {
        session.failPlay();
      }
    } catch (error) {
      session.failPlay();
      throw error;
    }
  };
