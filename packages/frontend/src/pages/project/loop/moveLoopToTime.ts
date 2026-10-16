import { type api } from '@musetric/api';
import { engine } from '../../../engine/engine.js';
import { moveLoop } from './loopActions.js';
import { getLoopAtTime } from './loopRange.js';

export const moveLoopToTime = (
  subtitle: readonly api.subtitle.Segment[],
  time: number,
): boolean => {
  const state = engine.store.get();
  if (state.loopStage === undefined) {
    return false;
  }
  if (state.loopStage === 'range') {
    const { sampleRate } = engine.context;
    moveLoop(getLoopAtTime(subtitle, time, { ...state, sampleRate }));
  }
  return true;
};
