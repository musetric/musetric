import { type PlayerMotion } from './motion.js';

export type EngineSession =
  'idle' | 'starting' | 'playing' | 'taking' | 'stopping';

export type EngineTake = 'none' | 'arming' | 'recording' | 'draining';

export type EngineTransport = {
  playing: boolean;
  recording: boolean;
  busy: boolean;
  buffering: boolean;
};

export type EngineSessionState = {
  session: EngineSession;
  take: EngineTake;
  motion: PlayerMotion;
  transport: EngineTransport;
  takeRefusal?: unknown;
};

export const readTransport = (
  state: Pick<EngineSessionState, 'session' | 'take' | 'motion'>,
): EngineTransport => ({
  playing:
    state.session === 'starting' ||
    state.session === 'playing' ||
    state.session === 'taking',
  recording: state.take !== 'none',
  busy:
    state.session === 'starting' ||
    state.session === 'stopping' ||
    state.take === 'arming' ||
    state.take === 'draining',
  buffering: state.motion === 'buffering',
});

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

export type EngineSessionStore = {
  update: (recipe: (state: EngineSessionState) => void) => void;
};

export const createEngineSessionMachine = (
  store: EngineSessionStore,
  mintTakeId: () => string,
): EngineSessionMachine => {
  const update = (recipe: (state: EngineSessionState) => void) => {
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
      return mintTakeId();
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
