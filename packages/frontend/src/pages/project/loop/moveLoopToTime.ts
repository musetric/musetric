import { type api } from '@musetric/api';
import { engine } from '../../../engine/engine.js';
import { isInsideLoop } from './createLoopRangeGesture.js';
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
  const { sampleRate } = engine.context;
  if (state.range && isInsideLoop(state.range, time * sampleRate)) {
    return state.recording;
  }
  if (state.loopStage === 'range') {
    moveLoop(getLoopAtTime(subtitle, time, { ...state, sampleRate }));
  }
  return true;
};
