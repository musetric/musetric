import { type StemType, stemTypes } from '@musetric/audio/es';
import {
  dropMixerPage,
  type InitOutput,
  mixerPageInput,
  mixerReady,
  mixStems,
  openMixer,
  reserveMixerPages,
  setMixerRange,
  setMixerStem,
  setMixerVolumes,
} from '@musetric/dsp/stretch';
import { type RangeFrames } from './playerRange.worklet.js';
import {
  type playerDataChannel,
  type PlayerPage,
  type PlayerPageKey,
  type PlayerStemLayouts,
} from './protocol.cross.js';

const windowReportFrameCount = 12000;
const mixerChannelCount = 2;

const stemIndices: Record<StemType, number> = {
  lead: 0,
  backing: 1,
  instrumental: 2,
};

export const allStemsMask = 0b111;
export const accompanimentMask = 0b110;
export const leadMask = 0b001;

export type PlayerTracks = {
  mounted: () => boolean;
  mount: (layouts: PlayerStemLayouts, residentPageLimit: number) => void;
  put: (page: PlayerPage) => void;
  drop: (pages: PlayerPageKey[]) => void;
  release: () => void;
  ready: (frameIndex: number) => boolean;
  setRange: (range: RangeFrames | undefined) => void;
  setVolumes: (volumes: Partial<Record<StemType, number>>) => void;
  mixInto: (
    inputBuffers: Float32Array[],
    firstFrame: number,
    frameCount: number,
    mask: number,
  ) => void;
  requestWindow: (frameIndex: number, force?: true) => void;
};

export const createPlayerTracks = (
  stretch: InitOutput,
  dataPort: ReturnType<typeof playerDataChannel.inbound<MessagePort>>,
  getRange: () => RangeFrames | undefined,
): PlayerTracks => {
  const handle = openMixer(mixerChannelCount, stemTypes.length);
  let mixedViews: Float32Array[] = [];
  let mounted = false;

  const viewMixed = (pointer: number, frameCount: number): Float32Array[] => {
    const first = mixedViews.at(0);
    if (
      !first ||
      first.buffer !== stretch.memory.buffer ||
      first.byteOffset !== pointer ||
      first.length !== frameCount
    ) {
      mixedViews = Array.from(
        { length: mixerChannelCount },
        (_, channel) =>
          new Float32Array(
            stretch.memory.buffer,
            pointer + channel * frameCount * Float32Array.BYTES_PER_ELEMENT,
            frameCount,
          ),
      );
    }
    return mixedViews;
  };
  let reportedFrameIndex: number | undefined = undefined;

  const release = () => {
    for (const stem of stemTypes) {
      setMixerStem(handle, stemIndices[stem], 0, new Uint32Array(0));
    }
    mounted = false;
    reportedFrameIndex = undefined;
  };

  return {
    mounted: () => mounted,
    mount: (layouts, residentPageLimit) => {
      for (const stem of stemTypes) {
        const layout = layouts[stem];
        setMixerStem(
          handle,
          stemIndices[stem],
          layout.frameCount,
          Uint32Array.from(layout.pageStarts),
        );
      }
      reserveMixerPages(handle, residentPageLimit);
      mounted = true;
      reportedFrameIndex = undefined;
    },
    put: (page) => {
      const pointer = mixerPageInput(
        handle,
        stemIndices[page.stem],
        page.index,
        page.samples.length,
      );
      if (pointer === 0) {
        return;
      }
      new Float32Array(stretch.memory.buffer, pointer, page.samples.length).set(
        page.samples,
      );
    },
    drop: (pages) => {
      for (const page of pages) {
        dropMixerPage(handle, stemIndices[page.stem], page.index);
      }
    },
    release,
    ready: (frameIndex) => mixerReady(handle, frameIndex),
    setRange: (range) => {
      setMixerRange(
        handle,
        range?.repeat === 'cycle',
        range
          ? Float64Array.of(
              range.range.fromFrame,
              range.range.toFrame,
              range.endFrame,
            )
          : new Float64Array(0),
      );
    },
    setVolumes: (volumes) => {
      setMixerVolumes(
        handle,
        Float32Array.from(stemTypes, (stem) => volumes[stem] ?? 1),
      );
    },
    mixInto: (inputBuffers, firstFrame, frameCount, mask) => {
      const mixed = viewMixed(
        mixStems(handle, firstFrame, frameCount, mask),
        frameCount,
      );
      for (let channel = 0; channel < inputBuffers.length; channel += 1) {
        inputBuffers[channel].set(
          mixed[Math.min(channel, mixerChannelCount - 1)],
        );
      }
    },
    requestWindow: (frameIndex, force) => {
      if (!mounted) {
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
