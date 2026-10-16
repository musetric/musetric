import { type Store } from '../common/store.js';
import {
  clampToRange,
  type EngineRange,
  type EngineRangePlay,
  type EngineRangeRepeat,
  type EngineState,
} from '../state.js';

export type CreateEnginePlayerRangeOptions = {
  store: Store<EngineState>;
  seek: (frameIndex: number) => void;
  startPlayback: () => Promise<void>;
};

export type EnginePlayerRange = {
  setRange: (range: EngineRange | undefined) => void;
  playRange: (
    repeat: EngineRangeRepeat,
    play?: EngineRangePlay,
  ) => Promise<void>;
  replayRange: (play?: EngineRangePlay) => Promise<void>;
};

export const createEnginePlayerRange = (
  options: CreateEnginePlayerRangeOptions,
): EnginePlayerRange => {
  const { store, seek, startPlayback } = options;

  const playRange = async (
    repeat: EngineRangeRepeat,
    play?: EngineRangePlay,
  ) => {
    const { range, playing } = store.get();
    if (!range) {
      return;
    }
    store.update((draft) => {
      draft.rangeRepeat = repeat;
      draft.rangeStopFrame = play?.stopFrame;
    });
    seek(play?.startFrame ?? range.fromFrame);
    if (!playing) {
      await startPlayback();
    }
  };

  return {
    setRange: (range) => {
      store.update((draft) => {
        draft.range = range;
        if (!range) {
          draft.rangeRepeat = 'cycle';
          draft.rangeStopFrame = undefined;
        }
      });
      const { frameIndex } = store.get();
      if (range && clampToRange(frameIndex, range) !== frameIndex) {
        seek(range.fromFrame);
      }
    },
    playRange,
    replayRange: async (play) => {
      const { playing, rangeRepeat } = store.get();
      await playRange(playing ? rangeRepeat : 'once', play);
    },
  };
};
