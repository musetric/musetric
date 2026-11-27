import { type Store } from '../common/store.js';
import { type EngineProject } from '../project/index.js';
import { type EngineState } from '../state.js';

export type SettleLoopTryOptions = {
  store: Store<EngineState>;
  project: EngineProject;
  settled: boolean;
  keep: boolean;
  tempoRatio: number;
};

export const settleLoopTry = async (options: SettleLoopTryOptions) => {
  const { store, project, tempoRatio } = options;
  const loopTry = options.settled
    ? await project.settleLoopTry(options.keep)
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
  project.selectLoopTry(state.loopSelectedTryId);
};
