import { type Store } from '../common/store.js';
import { type EngineStoreState, readTransport } from '../ownState.js';
import { type PlayerMotion } from './protocol.cross.js';

export type EngineSessionMachine = {
  beginPlay: () => void;
  settlePlay: () => void;
  failPlay: () => void;
  beginStop: () => void;
  settleStop: () => void;
  beginTake: () => string;
  settleTake: () => void;
  failTake: (wasPlaying: boolean) => void;
  beginDrain: () => void;
  settleDrain: () => void;
  endTake: () => void;
  applyMotion: (motion: PlayerMotion) => void;
};

export const createEngineSessionMachine = (
  store: Store<EngineStoreState>,
): EngineSessionMachine => {
  const update = (recipe: (state: EngineStoreState) => void) => {
    store.update((state) => {
      recipe(state);
      const transport = readTransport(state);
      state.transport.playing = transport.playing;
      state.transport.recording = transport.recording;
      state.transport.busy = transport.busy;
      state.transport.buffering = transport.buffering;
    });
  };
  return {
    beginPlay: () => {
      update((state) => {
        state.session = 'starting';
      });
    },
    settlePlay: () => {
      update((state) => {
        if (state.session === 'starting') {
          state.session = 'playing';
        }
      });
    },
    failPlay: () => {
      update((state) => {
        if (state.session === 'starting') {
          state.session = 'idle';
        }
      });
    },
    beginStop: () => {
      update((state) => {
        state.session = 'stopping';
      });
    },
    settleStop: () => {
      update((state) => {
        if (state.session === 'stopping') {
          state.session = 'idle';
        }
      });
    },
    beginTake: () => {
      update((state) => {
        state.session = 'taking';
        state.take = 'arming';
        state.takeRefusal = undefined;
      });
      return crypto.randomUUID();
    },
    settleTake: () => {
      update((state) => {
        if (state.take === 'arming') {
          state.take = 'recording';
        }
      });
    },
    failTake: (wasPlaying) => {
      update((state) => {
        state.take = 'none';
        if (state.session === 'taking') {
          state.session = wasPlaying ? 'playing' : 'idle';
        }
      });
    },
    beginDrain: () => {
      update((state) => {
        state.take = 'draining';
      });
    },
    settleDrain: () => {
      update((state) => {
        if (state.take === 'draining') {
          state.take = 'none';
        }
        if (state.session === 'taking') {
          state.session = 'playing';
        }
      });
    },
    endTake: () => {
      update((state) => {
        state.take = 'none';
        if (state.session === 'taking') {
          state.session = 'playing';
        }
      });
    },
    applyMotion: (motion) => {
      const playing = motion !== 'stopped';
      update((state) => {
        state.motion = motion;
        if (
          playing &&
          (state.session === 'idle' || state.session === 'starting')
        ) {
          state.session = state.take === 'none' ? 'playing' : 'taking';
        }
        const preparing =
          state.session === 'starting' ||
          (state.session === 'taking' && state.take === 'arming');
        if (
          !playing &&
          !preparing &&
          (state.session === 'playing' || state.session === 'taking')
        ) {
          state.session = 'idle';
        }
      });
    },
  };
};
