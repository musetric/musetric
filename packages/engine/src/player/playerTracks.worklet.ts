import { type StemType } from '@musetric/audio/es';
import { type RangeFrames } from './playerRange.worklet.js';
import {
  type playerDataChannel,
  type PlayerPage,
  type PlayerPageKey,
  type PlayerStemLayouts,
} from './protocol.cross.js';
import {
  createTrackPages,
  dropTrackPage,
  hasTrackFrame,
  putTrackPage,
  type TrackPages,
} from './trackPages.worklet.js';

const readyMarginFrameCount = 16384;
const readyStepFrameCount = 4096;
const windowReportFrameCount = 12000;

export type StemTracks = Record<StemType, TrackPages>;

export type PlayerTracks = {
  get: () => StemTracks | undefined;
  mount: (layouts: PlayerStemLayouts) => void;
  put: (page: PlayerPage) => void;
  drop: (pages: PlayerPageKey[]) => void;
  release: () => void;
  ready: (tracks: StemTracks, frameIndex: number) => boolean;
  requestWindow: (frameIndex: number, force?: true) => void;
};

export const createPlayerTracks = (
  dataPort: ReturnType<typeof playerDataChannel.inbound<MessagePort>>,
  getRange: () => RangeFrames | undefined,
): PlayerTracks => {
  let tracks: StemTracks | undefined = undefined;
  let reportedFrameIndex: number | undefined = undefined;

  const release = () => {
    for (const track of Object.values(tracks ?? {})) {
      for (let index = 0; index < track.pages.length; index += 1) {
        dropTrackPage(track, index);
      }
    }
    tracks = undefined;
    reportedFrameIndex = undefined;
  };

  return {
    get: () => tracks,
    mount: (layouts) => {
      release();
      tracks = {
        lead: createTrackPages(layouts.lead),
        backing: createTrackPages(layouts.backing),
        instrumental: createTrackPages(layouts.instrumental),
      };
    },
    put: (page) => {
      const track = tracks?.[page.stem];
      if (track) {
        putTrackPage(track, page);
      }
    },
    drop: (pages) => {
      for (const page of pages) {
        const track = tracks?.[page.stem];
        if (track) {
          dropTrackPage(track, page.index);
        }
      }
    },
    release,
    ready: (current, frameIndex) => {
      const range = getRange();
      const from = frameIndex - readyMarginFrameCount;
      const to = frameIndex + readyMarginFrameCount;
      for (let frame = from; frame <= to; frame += readyStepFrameCount) {
        const songFrame = range ? range.songFrame(frame) : frame;
        for (const track of Object.values(current)) {
          if (!hasTrackFrame(track, songFrame)) {
            return false;
          }
        }
      }
      return true;
    },
    requestWindow: (frameIndex, force) => {
      if (!tracks) {
        return;
      }
      if (
        !force &&
        reportedFrameIndex !== undefined &&
        Math.abs(frameIndex - reportedFrameIndex) < windowReportFrameCount
      ) {
        return;
      }
      reportedFrameIndex = frameIndex;
      const range = getRange();
      dataPort.methods.requestWindow({
        frameIndex,
        loop: range?.repeat === 'cycle' ? range.range : undefined,
      });
    },
  };
};
