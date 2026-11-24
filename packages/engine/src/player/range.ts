import { type Store } from '../common/store.js';
import {
  clampToRange,
  type EngineRange,
  type EngineRangePlay,
  type EngineRangeRepeat,
  type EngineState,
  isPlaying,
} from '../state.js';
import { type EngineCommandQueue } from './commandQueue.js';

export type CreateEnginePlayerRangeOptions = {
  store: Store<EngineState>;
  readPosition: () => number;
  seek: (frameIndex: number) => void;
  queue: EngineCommandQueue;
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
  const { store, seek, queue, startPlayback } = options;

  const playRange = async (
    repeat: EngineRangeRepeat,
    play?: EngineRangePlay,
  ) => {
    const { range } = store.get();
    const playing = isPlaying(store.get());
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
      const frameIndex = options.readPosition();
      if (range && clampToRange(frameIndex, range) !== frameIndex) {
        seek(range.fromFrame);
      }
    },
    playRange: async (repeat, play) =>
      queue.run(async () => playRange(repeat, play)),
    replayRange: async (play) =>
      queue.run(async () => {
        const { rangeRepeat } = store.get();
        const playing = isPlaying(store.get());
        await playRange(playing ? rangeRepeat : 'once', play);
      }),
  };
};
