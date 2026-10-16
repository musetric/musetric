import { type Store } from '../common/store.js';
import { type EngineDecoder } from '../decoder/index.js';
import { type EngineRange, type EngineState } from '../state.js';
import { type EngineRecorder } from './recorder.js';

export type EnginePlayerLoop = {
  openLoop: (range: EngineRange) => void;
  lockLoop: () => void;
  closeLoop: () => void;
  recordTry: (projectId: number) => Promise<void>;
  cancelTry: () => Promise<void>;
  selectTry: (tryId: string | undefined) => void;
  deleteTry: (tryId: string) => void;
  insertTry: (projectId: number, tryId: string) => Promise<boolean>;
  discardTries: () => void;
};

export type CreateEnginePlayerLoopOptions = {
  store: Store<EngineState>;
  getDecoder: () => EngineDecoder;
  getEngineRecorder: () => EngineRecorder;
  seek: (frameIndex: number) => void;
  setRange: (range: EngineRange | undefined) => void;
};

export const createEnginePlayerLoop = (
  options: CreateEnginePlayerLoopOptions,
): EnginePlayerLoop => {
  const { store, getDecoder, getEngineRecorder, seek, setRange } = options;

  const discardTries = () => {
    store.update((draft) => {
      draft.loopTries = [];
      draft.loopSelectedTryId = undefined;
    });
    getDecoder().discardLoopTries();
  };

  return {
    openLoop: (range) => {
      discardTries();
      store.update((draft) => {
        draft.loopStage = 'range';
      });
      setRange(range);
    },
    lockLoop: () => {
      store.update((draft) => {
        draft.loopStage = 'sing';
      });
    },
    closeLoop: () => {
      discardTries();
      store.update((draft) => {
        draft.loopStage = undefined;
      });
      setRange(undefined);
    },
    recordTry: async (projectId) => {
      const currentState = store.get();
      const { range, playing } = currentState;
      if (
        !range ||
        currentState.loopStage !== 'sing' ||
        currentState.playerCommandPending ||
        currentState.recording ||
        currentState.isSlave
      ) {
        return;
      }

      if (!playing) {
        seek(range.fromFrame);
      }
      store.update((draft) => {
        draft.rangeRepeat = 'cycle';
        draft.rangeStopFrame = undefined;
        draft.recording = true;
        draft.playing = true;
        draft.playerCommandPending = true;
        draft.loopTryPhase = 'armed';
      });
      try {
        getDecoder().sendPlayerRecord();
        await getEngineRecorder().record(projectId, !playing, true);
      } catch (error) {
        const state = store.get();
        if (!state.isSlave && !playing) {
          getDecoder().sendPlayerStop();
        } else if (!state.isSlave && state.playing) {
          getDecoder().sendPlayerPlay();
        }
        store.update((draft) => {
          draft.recording = false;
          draft.loopTryPhase = undefined;
          if (!playing) {
            draft.playing = false;
          }
        });
        throw error;
      } finally {
        store.update((draft) => {
          draft.playerCommandPending = false;
        });
      }
    },
    cancelTry: async () => {
      const currentState = store.get();
      if (
        currentState.playerCommandPending ||
        currentState.loopTryPhase === undefined
      ) {
        return;
      }

      store.update((draft) => {
        draft.playerCommandPending = true;
      });
      try {
        await getEngineRecorder().finish();
      } finally {
        store.update((draft) => {
          draft.playerCommandPending = false;
        });
      }
    },
    selectTry: (tryId) => {
      store.update((draft) => {
        draft.loopSelectedTryId = tryId;
      });
      getDecoder().selectLoopTry(tryId);
    },
    deleteTry: (tryId) => {
      store.update((draft) => {
        draft.loopTries = draft.loopTries.filter((item) => item.id !== tryId);
        if (draft.loopSelectedTryId === tryId) {
          draft.loopSelectedTryId = undefined;
        }
      });
      getDecoder().deleteLoopTry(tryId);
    },
    insertTry: async (projectId, tryId) => {
      const inserted = await getDecoder().insertLoopTry(projectId, tryId);
      if (inserted) {
        store.update((draft) => {
          draft.loopTries = draft.loopTries.filter((item) => item.id !== tryId);
          if (draft.loopSelectedTryId === tryId) {
            draft.loopSelectedTryId = undefined;
          }
        });
      }
      return inserted;
    },
    discardTries,
  };
};
