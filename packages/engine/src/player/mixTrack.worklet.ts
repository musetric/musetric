import { type StemType, stemTypes } from '@musetric/audio/es';
import {
  createTrackPageReader,
  type TrackPages,
} from './trackPages.worklet.js';

const accompanimentStemTypes = stemTypes.filter(
  (stemType) => stemType !== 'lead',
);

export type MixTrackFrames = {
  songFrame: (frame: number) => number;
  gain: (songFrame: number) => number;
};

export type MixTrackIntoBuffersOptions = {
  inputBuffers: Float32Array[];
  outputFrameIndex: number;
  inputFrameOffset: number;
  inputFrameCount: number;
  channelCount: number;
  track: TrackPages | undefined;
  volume: number;
  frames?: MixTrackFrames;
};

export const mixTrackIntoBuffers = (options: MixTrackIntoBuffersOptions) => {
  const {
    inputBuffers,
    outputFrameIndex,
    inputFrameOffset,
    inputFrameCount,
    channelCount,
    track,
    volume,
    frames,
  } = options;
  if (!track) {
    return;
  }

  const read = createTrackPageReader(track);
  for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
    const input = inputBuffers[channelIndex];
    const frameBase = outputFrameIndex + inputFrameOffset;
    if (!frames) {
      for (let offset = 0; offset < inputFrameCount; offset += 1) {
        input[offset] += read(channelIndex, frameBase + offset) * volume;
      }
      continue;
    }
    for (let offset = 0; offset < inputFrameCount; offset += 1) {
      const songFrame = frames.songFrame(frameBase + offset);
      input[offset] +=
        read(channelIndex, songFrame) * volume * frames.gain(songFrame);
    }
  }
};

export type MixStemsIntoBuffersOptions = Omit<
  MixTrackIntoBuffersOptions,
  'track' | 'volume'
> & {
  tracks: Record<StemType, TrackPages>;
  volumes: Partial<Record<StemType, number>>;
  leadApart: boolean;
};

export const mixStemsIntoBuffers = (options: MixStemsIntoBuffersOptions) => {
  const { tracks, volumes, leadApart } = options;
  for (const stemType of leadApart ? accompanimentStemTypes : stemTypes) {
    mixTrackIntoBuffers({
      ...options,
      track: tracks[stemType],
      volume: volumes[stemType] ?? 1,
    });
  }
};
