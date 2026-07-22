const subtitleSeekLeadSeconds = 0.15;

export type SubtitleSeekState = {
  duration: number;
  frameCount?: number;
};

export const getSubtitleSeekFrameIndex = (
  playbackTime: number,
  state: SubtitleSeekState,
) => {
  const { duration, frameCount } = state;
  if (!frameCount || duration <= 0) return undefined;

  const seekTime = Math.max(0, playbackTime - subtitleSeekLeadSeconds);
  return Math.floor((seekTime / duration) * frameCount);
};
