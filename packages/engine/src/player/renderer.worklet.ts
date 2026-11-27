import { type StemType, stemTypes } from '@musetric/audio/es';
import {
  dropRendererPage,
  type InitOutput,
  openRenderer,
  refillRenderer,
  rendererOutput,
  rendererPageInput,
  rendererReady,
  renderQuantum,
  reserveRendererPages,
  resetRenderer,
  setRendererRange,
  setRendererRecordingVolume,
  setRendererTakes,
  setRendererTempo,
  setRendererTrack,
  setRendererTranspose,
  setRendererVoice,
  setRendererVolumes,
} from '@musetric/dsp/stretch';
import { type RangeFrames } from '@musetric/transport';
import {
  type playerDataChannel,
  type PlayerPage,
  type PlayerPageKey,
  type PlayerStemLayout,
  type PlayerStemLayouts,
  type PlayerTakes,
  stemTracks,
} from './protocol.cross.js';

const windowReportFrameCount = 12000;
const outputChannelCount = 2;

const createOutputViews = (
  buffer: ArrayBuffer,
  pointer: number,
  frameCount: number,
): Float32Array[] =>
  Array.from(
    { length: outputChannelCount },
    (_, channel) =>
      new Float32Array(
        buffer,
        pointer + channel * frameCount * Float32Array.BYTES_PER_ELEMENT,
        frameCount,
      ),
  );

const emptyLayout: PlayerStemLayout = { frameCount: 0, pageStarts: [] };

export type PlayerRenderer = {
  mounted: () => boolean;
  mount: (layouts: PlayerStemLayouts, takes: PlayerTakes) => void;
  setTakes: (takes: PlayerTakes) => void;
  put: (page: PlayerPage) => void;
  drop: (pages: PlayerPageKey[]) => void;
  release: () => void;
  ready: (frameIndex: number) => boolean;
  setRange: (range: RangeFrames | undefined) => void;
  setVolumes: (volumes: Partial<Record<StemType, number>>) => void;
  requestWindow: (frameIndex: number, force?: true) => void;
  setTempoRatio: (tempoRatio: number) => void;
  setTransposeSemitones: (transposeSemitones: number) => void;
  setVoice: (voiceOctave: number, shifted: boolean) => void;
  setRecordingVolume: (volume: number) => void;
  reset: () => void;
  refill: () => void;
  render: (
    outputs: Float32Array[],
    frameIndex: number,
    takeFrame: number | undefined,
  ) => number;
};

export type CreatePlayerRendererOptions = {
  stretch: InitOutput;
  sampleRate: number;
  dataPort: ReturnType<typeof playerDataChannel.inbound<MessagePort>>;
  getRange: () => RangeFrames | undefined;
};

export const createPlayerRenderer = (
  options: CreatePlayerRendererOptions,
): PlayerRenderer => {
  const { stretch, dataPort, getRange } = options;
  const handle = openRenderer(options.sampleRate);
  let outputViews: Float32Array[] = [];
  let mounted = false;
  let reportedFrameIndex: number | undefined = undefined;
  let takeTracks: number[] = [];

  const viewOutput = (frameCount: number): Float32Array[] => {
    const pointer = rendererOutput(handle);
    const first = outputViews.at(0);
    if (
      !first ||
      first.buffer !== stretch.memory.buffer ||
      first.byteOffset !== pointer ||
      first.length !== frameCount
    ) {
      // eslint-disable-next-line musetric/no-audio-thread-allocations -- once, when the module's memory grows or a quantum changes its length
      outputViews = createOutputViews(
        stretch.memory.buffer,
        pointer,
        frameCount,
      );
    }
    return outputViews;
  };

  const setTrack = (track: number, layout: PlayerStemLayout) => {
    setRendererTrack(
      handle,
      track,
      layout.frameCount,
      Uint32Array.from(layout.pageStarts),
    );
  };

  const setTakes = (message: PlayerTakes) => {
    const tracks = message.takes.map((take) => take.track);
    for (const track of takeTracks.filter((held) => !tracks.includes(held))) {
      setTrack(track, emptyLayout);
    }
    takeTracks = tracks;
    for (const take of message.takes) {
      setTrack(take.track, take);
    }
    const pieces = message.takes
      .filter((take) => take.sounding)
      .flatMap((take) => [
        take.track,
        take.songStartFrame,
        take.tempo,
        take.transpose,
        take.octave,
        take.frameCount,
      ]);
    if (!setRendererTakes(handle, Float64Array.from(pieces))) {
      throw new Error('The takes of the recording do not fit the renderer');
    }
    reserveRendererPages(handle, message.residentPageLimit);
  };

  const release = () => {
    for (const stem of stemTypes) {
      setTrack(stemTracks[stem], emptyLayout);
    }
    setTakes({ takes: [], residentPageLimit: 0 });
    mounted = false;
    reportedFrameIndex = undefined;
  };

  return {
    mounted: () => mounted,
    mount: (layouts, takes) => {
      release();
      for (const stem of stemTypes) {
        setTrack(stemTracks[stem], layouts[stem]);
      }
      setTakes(takes);
      mounted = true;
      reportedFrameIndex = undefined;
    },
    setTakes,
    put: (page) => {
      const pointer = rendererPageInput(
        handle,
        page.track,
        page.index,
        page.samples.length,
      );
      if (pointer !== 0) {
        new Float32Array(
          stretch.memory.buffer,
          pointer,
          page.samples.length,
        ).set(page.samples);
      }
      page.samples.buffer.transfer(0);
    },
    drop: (pages) => {
      for (const page of pages) {
        dropRendererPage(handle, page.track, page.index);
      }
    },
    release,
    ready: (frameIndex) => rendererReady(handle, frameIndex),
    setRange: (range) => {
      setRendererRange(
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
      setRendererVolumes(
        handle,
        Float32Array.from(stemTypes, (stem) => volumes[stem] ?? 1),
      );
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
      // eslint-disable-next-line musetric/no-audio-thread-allocations -- a window request, on a jump or after 12000 frames of the song
      dataPort.methods.requestWindow({
        frameIndex,
        loop: range?.repeat === 'cycle' ? range.range : undefined,
      });
    },
    setTempoRatio: (tempoRatio) => {
      setRendererTempo(handle, tempoRatio);
    },
    setTransposeSemitones: (transposeSemitones) => {
      setRendererTranspose(handle, transposeSemitones);
    },
    setVoice: (voiceOctave, shifted) => {
      setRendererVoice(handle, voiceOctave, shifted);
    },
    setRecordingVolume: (volume) => {
      setRendererRecordingVolume(handle, volume);
    },
    reset: () => {
      resetRenderer(handle);
    },
    refill: () => {
      refillRenderer(handle);
    },
    render: (outputs, frameIndex, takeFrame) => {
      const frameCount = outputs[0].length;
      const processed = renderQuantum(
        handle,
        frameIndex,
        takeFrame ?? Number.NaN,
        frameCount,
      );
      const rendered = viewOutput(frameCount);
      for (let channel = 0; channel < outputs.length; channel += 1) {
        outputs[channel].set(
          rendered[Math.min(channel, outputChannelCount - 1)],
        );
      }
      return processed;
    },
  };
};
