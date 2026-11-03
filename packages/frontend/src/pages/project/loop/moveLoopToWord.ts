import { type api } from '@musetric/api';
import { engine } from '../../../engine/engine.js';
import { isSubtitleWordStartInRange } from '../subtitle/subtitleLoopBands.js';
import { moveLoop } from './loopActions.js';
import { getLoopAtTime } from './loopRange.js';

export const moveLoopToWord = (
  subtitle: readonly api.subtitle.Segment[],
  wordStart: number,
): boolean => {
  const state = engine.store.get();
  if (state.loopStage === undefined) {
    return false;
  }
  const { sampleRate } = engine.context;
  if (
    state.range &&
    isSubtitleWordStartInRange(subtitle, wordStart, state.range, sampleRate)
  ) {
    return state.recording;
  }
  if (state.loopStage === 'range') {
    moveLoop(getLoopAtTime(subtitle, wordStart, { ...state, sampleRate }));
  }
  return true;
};
