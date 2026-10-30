import {
  analyzeVocalVoice,
  assessVocalLesson,
  type SpectrogramSource,
  type VocalVoice,
} from '@musetric/spectrogram';
import { pitchTrackHop, trackPitch } from '@musetric/spectrogram/gpu';
import { type VocalLessonUpdate } from './protocol.cross.js';

const takeDelayMs = 800;
const takeMarginSeconds = 0.5;
const pauseBudgetMs = 12;

const createPause = () => {
  let resumedAt = performance.now();
  return async () => {
    if (performance.now() - resumedAt < pauseBudgetMs) {
      return;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    resumedAt = performance.now();
  };
};

const songSampleOf = (source: SpectrogramSource, sample: number): number => {
  let low = 0;
  let high = source.songLength;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (source.position(middle) <= sample) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return low;
};

const soundedRange = (samples: Float32Array) => {
  const first = samples.findIndex((value) => value !== 0);
  if (first < 0) {
    return undefined;
  }
  const last = samples.findLastIndex((value) => value !== 0);
  return { first, last };
};

export type VocalLesson = {
  setEnabled: (enabled: boolean) => void;
  setLead: (samples: Float32Array | undefined) => void;
  setTake: (source: SpectrogramSource | undefined) => void;
};

export type CreateVocalLessonOptions = {
  device: GPUDevice;
  sampleRate: number;
  publish: (update: VocalLessonUpdate) => void;
};

export const createVocalLesson = (
  options: CreateVocalLessonOptions,
): VocalLesson => {
  const { device, sampleRate, publish } = options;
  const pause = createPause();
  let enabled = false;
  let leadSamples: Float32Array | undefined = undefined;
  let leadVoice: Promise<VocalVoice> | undefined = undefined;
  let takeSource: SpectrogramSource | undefined = undefined;
  let version = 0;
  let takeTimer: ReturnType<typeof setTimeout> | undefined = undefined;

  const analyzeLead = async (samples: Float32Array) => {
    const line = await trackPitch({ device, samples });
    return analyzeVocalVoice({
      samples,
      sampleRate,
      line,
      pause,
      songSample: (sample) => sample,
    });
  };

  const analyzeTake = async (
    source: SpectrogramSource,
  ): Promise<VocalVoice | undefined> => {
    const samples = new Float32Array(source.length);
    source.read(samples, 0, 0, source.length);
    const range = soundedRange(samples);
    if (!range) {
      return undefined;
    }
    const margin = Math.round(takeMarginSeconds * sampleRate);
    const firstFrame = Math.floor(
      Math.max(0, range.first - margin) / pitchTrackHop,
    );
    const lastFrame = Math.ceil(
      Math.min(samples.length, range.last + margin) / pitchTrackHop,
    );
    const line = await trackPitch({
      device,
      samples,
      firstFrame,
      frameCount: Math.max(1, lastFrame - firstFrame),
    });
    return analyzeVocalVoice({
      samples,
      sampleRate,
      line,
      pause,
      songSample: (sample) => songSampleOf(source, sample),
    });
  };

  const refresh = async () => {
    version += 1;
    const current = version;
    const samples = leadSamples;
    if (!enabled || !samples) {
      publish({ status: 'idle', phrases: [] });
      return;
    }
    publish({ status: 'analyzing' });
    try {
      leadVoice ??= analyzeLead(samples);
      const lead = await leadVoice;
      const take = takeSource ? await analyzeTake(takeSource) : undefined;
      if (current !== version) {
        return;
      }
      publish({ status: 'ready', phrases: assessVocalLesson(lead, take) });
    } catch (error) {
      if (current === version) {
        console.error('Failed to analyze the voices', error);
        publish({ status: 'idle', phrases: [] });
      }
    }
  };

  const scheduleTake = () => {
    clearTimeout(takeTimer);
    takeTimer = setTimeout(() => {
      void refresh();
    }, takeDelayMs);
  };

  return {
    setEnabled: (next) => {
      if (next === enabled) {
        return;
      }
      enabled = next;
      void refresh();
    },
    setLead: (samples) => {
      leadSamples = samples;
      leadVoice = undefined;
      takeSource = undefined;
      void refresh();
    },
    setTake: (source) => {
      takeSource = source;
      scheduleTake();
    },
  };
};
