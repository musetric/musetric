import { type EngineRange, type EngineRangePlay } from '@musetric/engine';
import { engine } from '../../../engine/engine.js';
import { hideLoopView, showLoopView } from './loopView.js';

export const openLoop = (range: EngineRange) => {
  engine.player.openLoop(range);
  showLoopView(range);
  void engine.player.replayRange();
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
