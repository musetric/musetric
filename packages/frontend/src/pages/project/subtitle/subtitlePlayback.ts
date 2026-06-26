import { type EngineState, getTrackProgress } from '@musetric/engine/state';

export const getSubtitlePlaybackTimeFromState = (state: EngineState) => {
  return state.duration * getTrackProgress(state);
};
