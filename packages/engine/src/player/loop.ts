import { type EngineSessionMachine } from '@musetric/transport';
import { type Store } from '../common/store.js';
import { type EngineDecoder } from '../decoder/index.js';
import { type EngineStoreState } from '../ownState.js';
import { type EngineRange, isPlaying, isRecording } from '../state.js';
import { type EngineCommandQueue } from './commandQueue.js';
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
  store: Store<EngineStoreState>;
  session: EngineSessionMachine;
  queue: EngineCommandQueue;
  getDecoder: () => EngineDecoder;
  getEngineRecorder: () => EngineRecorder;
  recordTake: (
    projectId: number,
    takeId: string,
    startPlayback: boolean,
    pass: boolean,
  ) => Promise<boolean>;
  seek: (frameIndex: number) => void;
  setRange: (range: EngineRange | undefined) => void;
};

export const createEnginePlayerLoop = (
  options: CreateEnginePlayerLoopOptions,
): EnginePlayerLoop => {
  const { store, session, queue, getDecoder, getEngineRecorder } = options;
  const { recordTake } = options;
  const { seek, setRange } = options;

  const discardTries = () => {
    store.update((draft) => {
      draft.loopTries = [];
      draft.loopSelectedTryId = undefined;
    });
    getDecoder().discardLoopTries();
  };

  const cancelTry = async () => {
    if (store.get().loopTryPhase === undefined) {
      return;
    }

    session.beginDrain();
    try {
      await getEngineRecorder().finish();
    } finally {
      session.settleDrain();
    }
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
      void queue.run(cancelTry);
      discardTries();
      store.update((draft) => {
        draft.loopStage = undefined;
      });
      setRange(undefined);
    },
    recordTry: async (projectId) =>
      queue.run(async () => {
        const currentState = store.get();
        const { range } = currentState;
        const playing = isPlaying(currentState);
        if (
          !range ||
          currentState.loopStage !== 'sing' ||
          isRecording(currentState)
        ) {
          return;
        }

        if (!playing) {
          seek(range.fromFrame);
        }
        store.update((draft) => {
          draft.rangeRepeat = 'cycle';
          draft.rangeStopFrame = undefined;
          draft.loopTryPhase = 'armed';
        });
        const takeId = session.beginTake();
        const failTry = () => {
          store.update((draft) => {
            draft.loopTryPhase = undefined;
          });
          session.failTake(playing);
        };
        try {
          if (await recordTake(projectId, takeId, !playing, true)) {
            session.settleTake();
          } else {
            failTry();
          }
        } catch (error) {
          failTry();
          throw error;
        }
      }),
    cancelTry: async () => queue.run(cancelTry),
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
