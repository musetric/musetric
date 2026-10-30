import {
  allTrackKeys,
  createHarmonicFilter,
  type HarmonicFilter,
  mapTrackKeys,
  type TrackKey,
} from '@musetric/spectrogram/es';
import { type FundamentalFramesMethods } from '../common/fundamentalChannel.cross.js';

const fundamentalRingSize = 16_384;
const filteredRingSize = 65_536;
const filterChannelCount = 2;
const prerollSeconds = 0.05;
const voiceJumpSeconds = 0.05;

type FundamentalRing = {
  hopSamples: number;
  values: Float32Array;
  frames: Int32Array;
};

const createFundamentalRing = (): FundamentalRing => ({
  hopSamples: 0,
  values: new Float32Array(fundamentalRingSize),
  frames: new Int32Array(fundamentalRingSize).fill(-1),
});

const readFundamental = (ring: FundamentalRing, frame: number): number => {
  if (frame < 0) {
    return 0;
  }
  const slot = frame % fundamentalRingSize;
  return ring.frames[slot] === frame ? ring.values[slot] : 0;
};

const fundamentalAt = (ring: FundamentalRing, sampleIndex: number) => {
  if (ring.hopSamples <= 0) {
    return 0;
  }
  const position = sampleIndex / ring.hopSamples - 0.5;
  const frame = Math.floor(position);
  const previous = readFundamental(ring, frame);
  const next = readFundamental(ring, frame + 1);
  if (previous > 0 && next > 0) {
    return previous + (next - previous) * (position - frame);
  }
  return position - frame < 0.5 ? previous : next;
};

export type HarmonicMixOptions = {
  trackKey: TrackKey;
  track: Float32Array[];
  inputBuffers: Float32Array[];
  frameBase: number;
  frameCount: number;
  channelCount: number;
  volume: number;
};

export type HarmonicSource = {
  isActive: () => boolean;
  setHarmonics: (harmonics: readonly number[]) => void;
  setFundamentalFrames: FundamentalFramesMethods['setFundamentalFrames'];
  reset: (trackKey?: TrackKey) => void;
  mix: (options: HarmonicMixOptions) => void;
  filterVoice: (
    samples: Float32Array,
    songFrame: number,
    tempoRatio: number,
  ) => void;
};

type FilteredLane = {
  filter: HarmonicFilter;
  rings: Float32Array[];
  end: number;
  valid: boolean;
};

export const createHarmonicSource = (sampleRate: number): HarmonicSource => {
  const prerollFrames = Math.round(prerollSeconds * sampleRate);
  const fundamentals = mapTrackKeys(createFundamentalRing);
  const lanes = mapTrackKeys<FilteredLane>(() => ({
    filter: createHarmonicFilter(sampleRate, filterChannelCount),
    rings: Array.from(
      { length: filterChannelCount },
      () => new Float32Array(filteredRingSize),
    ),
    end: 0,
    valid: false,
  }));
  const input = new Float32Array(filterChannelCount);
  const output = new Float32Array(filterChannelCount);
  const voiceFilter = createHarmonicFilter(sampleRate, 1);
  const voiceInput = new Float32Array(1);
  const voiceOutput = new Float32Array(1);
  const voiceJumpFrames = Math.round(voiceJumpSeconds * sampleRate);
  let voiceNextFrame: number | undefined = undefined;
  let active = false;

  const filterForward = (options: HarmonicMixOptions, end: number) => {
    const lane = lanes[options.trackKey];
    const ring = fundamentals[options.trackKey];
    const { track } = options;
    while (lane.end < end) {
      const frame = lane.end;
      for (let channel = 0; channel < filterChannelCount; channel += 1) {
        input[channel] = (track[channel] ?? track[0])[frame] ?? 0;
      }
      lane.filter.process(fundamentalAt(ring, frame), input, output);
      const slot = frame % filteredRingSize;
      for (let channel = 0; channel < filterChannelCount; channel += 1) {
        lane.rings[channel][slot] = output[channel];
      }
      lane.end += 1;
    }
  };

  const ensureFiltered = (options: HarmonicMixOptions) => {
    const lane = lanes[options.trackKey];
    const start = Math.max(0, options.frameBase);
    const end = options.frameBase + options.frameCount;
    const outsideHistory =
      start > lane.end || start <= lane.end - filteredRingSize;
    if (!lane.valid || outsideHistory) {
      lane.filter.reset();
      lane.end = Math.max(0, start - prerollFrames);
      lane.valid = true;
    }
    filterForward(options, end);
  };

  return {
    isActive: () => active,
    setHarmonics: (harmonics) => {
      active = harmonics.length > 0;
      for (const key of allTrackKeys) {
        lanes[key].filter.setHarmonics(harmonics);
        lanes[key].valid = false;
      }
      voiceFilter.setHarmonics(harmonics);
      voiceNextFrame = undefined;
    },
    setFundamentalFrames: (message) => {
      const ring = fundamentals[message.trackKey];
      ring.hopSamples = message.hopSeconds * sampleRate;
      message.values.forEach((value, index) => {
        const frame = message.firstFrame + index;
        const slot = frame % fundamentalRingSize;
        ring.values[slot] = value;
        ring.frames[slot] = frame;
      });
    },
    reset: (trackKey) => {
      for (const key of trackKey ? [trackKey] : allTrackKeys) {
        lanes[key].valid = false;
      }
      if (!trackKey || trackKey === 'recording') {
        voiceNextFrame = undefined;
      }
    },
    mix: (options) => {
      ensureFiltered(options);
      const lane = lanes[options.trackKey];
      for (let channel = 0; channel < options.channelCount; channel += 1) {
        const target = options.inputBuffers[channel];
        const ring = lane.rings[Math.min(channel, filterChannelCount - 1)];
        for (let offset = 0; offset < options.frameCount; offset += 1) {
          const frame = options.frameBase + offset;
          if (frame >= 0) {
            target[offset] += ring[frame % filteredRingSize] * options.volume;
          }
        }
      }
    },
    filterVoice: (samples, songFrame, tempoRatio) => {
      const jumped =
        voiceNextFrame === undefined ||
        Math.abs(songFrame - voiceNextFrame) > voiceJumpFrames;
      if (jumped) {
        voiceFilter.reset();
      }
      const ring = fundamentals.recording;
      for (let index = 0; index < samples.length; index += 1) {
        voiceInput[0] = samples[index];
        voiceFilter.process(
          fundamentalAt(ring, songFrame + index * tempoRatio),
          voiceInput,
          voiceOutput,
        );
        samples[index] = voiceOutput[0];
      }
      voiceNextFrame = songFrame + samples.length * tempoRatio;
    },
  };
};
