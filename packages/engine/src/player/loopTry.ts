import { type Store } from '../common/store.js';
import { type EngineDecoder } from '../decoder/index.js';
import { type EngineState } from '../state.js';

export type SettleLoopTryOptions = {
  store: Store<EngineState>;
  decoder: EngineDecoder;
  settled: boolean;
  keep: boolean;
  tempoRatio: number;
  keepPlaying: boolean;
};

export const settleLoopTry = async (options: SettleLoopTryOptions) => {
  const { store, decoder, tempoRatio, keepPlaying } = options;
  const loopTry = options.settled
    ? await decoder.settleLoopTry(options.keep)
    : undefined;
  store.update((state) => {
    state.loopTryPhase = undefined;
    if (!loopTry) {
      return;
    }
    state.loopTries.push({
      id: loopTry.id,
      number: (state.loopTries.at(-1)?.number ?? 0) + 1,
      startFrame: loopTry.startFrame,
      frameCount: loopTry.frameCount,
      tempoRatio,
    });
    state.loopSelectedTryId = loopTry.id;
  });
  const state = store.get();
  decoder.selectLoopTry(state.loopSelectedTryId);
  if (keepPlaying && state.playing && !state.isSlave) {
    decoder.sendPlayerPlay();
  }
};
