import { findPageIndex, pageEndFrame } from './pageLayout.cross.js';
import { type PlayerStemLayout } from './protocol.cross.js';

type TrackPage = {
  buffer: ArrayBuffer;
  channels: Float32Array[];
};

export type TrackPages = {
  frameCount: number;
  pageStarts: number[];
  pages: (TrackPage | undefined)[];
};

export const createTrackPages = (layout: PlayerStemLayout): TrackPages => ({
  frameCount: layout.frameCount,
  pageStarts: layout.pageStarts,
  pages: layout.pageStarts.map(() => undefined),
});

export const dropTrackPage = (track: TrackPages, index: number): void => {
  track.pages[index]?.buffer.transfer(0);
  track.pages[index] = undefined;
};

export type TrackPagesPut = {
  index: number;
  samples: Float32Array<ArrayBuffer>;
  frameCount: number;
  channelCount: number;
};

export const putTrackPage = (track: TrackPages, page: TrackPagesPut): void => {
  const { index, samples, frameCount, channelCount } = page;
  dropTrackPage(track, index);
  track.pages[index] = {
    buffer: samples.buffer,
    channels: Array.from({ length: channelCount }, (_, channel) =>
      samples.subarray(channel * frameCount, (channel + 1) * frameCount),
    ),
  };
};

export const hasTrackFrame = (track: TrackPages, frame: number): boolean => {
  const index = findPageIndex(track, frame);
  return index < 0 || track.pages[index] !== undefined;
};

export type TrackPageReader = (channel: number, frame: number) => number;

export const createTrackPageReader = (track: TrackPages): TrackPageReader => {
  let start = 0;
  let end = 0;
  let channels: Float32Array[] | undefined = undefined;
  return (channel, frame) => {
    if (frame < start || frame >= end) {
      const index = findPageIndex(track, frame);
      if (index < 0) {
        return 0;
      }
      start = track.pageStarts[index];
      end = pageEndFrame(track, index);
      channels = track.pages[index]?.channels;
    }
    if (!channels) {
      return 0;
    }
    const samples = channels[channel] ?? channels[0];
    return samples[frame - start] ?? 0;
  };
};
