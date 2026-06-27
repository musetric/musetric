import { type EngineState, getTrackProgress } from '@musetric/engine';

export const getSubtitlePlaybackTimeFromState = (state: EngineState) => {
  return state.duration * getTrackProgress(state);
};
