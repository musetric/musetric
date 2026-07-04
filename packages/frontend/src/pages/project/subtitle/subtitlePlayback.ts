import { type EngineState, getTrackProgress } from '@musetric/engine';

export const getSubtitlePlaybackTimeFromState = (state: EngineState) =>
  state.duration * getTrackProgress(state);
