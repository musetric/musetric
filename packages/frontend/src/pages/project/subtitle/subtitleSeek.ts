import { type EngineState } from '@musetric/engine/state';

const subtitleSeekLeadSeconds = 0.15;

export const getSubtitleSeekFrameIndex = (
  playbackTime: number,
  engineState: Pick<EngineState, 'duration' | 'frameCount'>,
) => {
  const { duration, frameCount } = engineState;
  if (!frameCount || duration <= 0) {
    return;
  }

  const seekTime = Math.max(0, playbackTime - subtitleSeekLeadSeconds);
  return Math.floor((seekTime / duration) * frameCount);
};
