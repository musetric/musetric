import { type api } from '@musetric/api';
import {
  type EngineRange,
  type EngineRangePlay,
  type EngineState,
} from '@musetric/engine';
import { engine } from '../../../engine/engine.js';
import { getLoopAtTime } from './loopRange.js';
import { hideLoopView, showLoopView } from './loopView.js';

export const isLoopAvailable = (state: EngineState): boolean =>
  Boolean(state.frameCount) &&
  !state.isSlave &&
  !state.recording &&
  state.statuses.realtime !== 'error';

export const openLoop = (range: EngineRange) => {
  engine.player.openLoop(range);
  showLoopView(range);
  void engine.player.replayRange();
};

export const enterLoop = (subtitle: readonly api.subtitle.Segment[]) => {
  const state = engine.store.get();
  const { sampleRate } = engine.context;
  openLoop(
    getLoopAtTime(subtitle, state.frameIndex / sampleRate, {
      ...state,
      sampleRate,
    }),
  );
};

export const previewLoop = (range: EngineRange) => {
  if (engine.store.get().loopStage === undefined) {
    engine.player.openLoop(range);
  } else {
    engine.player.setRange(range);
  }
  showLoopView(range);
};

export const moveLoop = (range: EngineRange, play?: EngineRangePlay) => {
  engine.player.setRange(range);
  showLoopView(range);
  void engine.player.replayRange(play);
};

export const lockLoop = () => {
  engine.player.lockLoop();
  hideLoopView();
};

export const closeLoop = () => {
  engine.player.closeLoop();
  hideLoopView();
};

export const leaveLoop = () => {
  if (engine.store.get().loopTries.length === 0) {
    closeLoop();
  }
};

export const applyLoopTry = async (projectId: number): Promise<boolean> => {
  const { loopSelectedTryId } = engine.store.get();
  if (loopSelectedTryId === undefined) {
    return false;
  }
  const inserted = await engine.player.insertTry(projectId, loopSelectedTryId);
  if (inserted) {
    closeLoop();
  }
  return inserted;
};
