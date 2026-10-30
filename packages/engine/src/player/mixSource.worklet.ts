import { type TrackKey } from '@musetric/spectrogram/es';
import { type HarmonicSource } from './harmonicSource.worklet.js';
import {
  mixTrackIntoBuffers,
  type MixTrackIntoBuffersOptions,
} from './mixTrack.worklet.js';

type MixSourceTrackOptions = MixTrackIntoBuffersOptions & {
  trackKey: TrackKey | undefined;
};

export const mixSourceTrack = (
  harmonicSource: HarmonicSource,
  mixOptions: MixSourceTrackOptions,
) => {
  const { trackKey, track, frames } = mixOptions;
  if (!trackKey || !track || frames || !harmonicSource.isActive()) {
    mixTrackIntoBuffers(mixOptions);
    return;
  }
  harmonicSource.mix({
    trackKey,
    track,
    inputBuffers: mixOptions.inputBuffers,
    frameBase: mixOptions.outputFrameIndex + mixOptions.inputFrameOffset,
    frameCount: mixOptions.inputFrameCount,
    channelCount: mixOptions.channelCount,
    volume: mixOptions.volume,
  });
};
