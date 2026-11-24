import { type EngineState, getTrackProgress } from '@musetric/engine';

export const getSubtitlePlaybackTime = (
  frameIndex: number,
  state: EngineState,
): number => state.duration * getTrackProgress(frameIndex, state.frameCount);
