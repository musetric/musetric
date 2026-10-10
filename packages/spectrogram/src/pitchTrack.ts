import { type SpectrogramConfig } from './config.cross.js';
import { defaultSpectrogramConfig } from './defaultConfig.cross.js';
import { createPitchSettings } from './fundamentalFrequency/settings.es.js';
import {
  createSpectrogramProcessor,
  type SpectrogramProcessor,
} from './processor.js';

const { sampleRate } = defaultSpectrogramConfig;
const defaultColumns = 4096;

const renderUntilComplete = async (
  processor: SpectrogramProcessor,
  samples: Float32Array,
  progress: number,
): Promise<void> => {
  await processor.render({ lead: samples }, progress);
  while (processor.hasPendingWork()) {
    await processor.render({ lead: samples }, progress);
  }
};

export type PitchTrackOptions = {
  device: GPUDevice;
  samples: Float32Array;
  firstFrame?: number;
  frameCount?: number;
  columns?: number;
  windowSize?: number;
  zeroPaddingFactor?: SpectrogramConfig['zeroPaddingFactor'];
};

export type PitchTrack = {
  hopSeconds: number;
  firstFrame: number;
  values: Float32Array;
  confidence: Float32Array;
};

export const trackPitch = async (
  options: PitchTrackOptions,
): Promise<PitchTrack> => {
  const { device, samples } = options;
  const { hop } = createPitchSettings(sampleRate);
  const firstFrame = options.firstFrame ?? 0;
  const frameCount =
    options.frameCount ?? Math.floor(samples.length / hop) - firstFrame;
  const columns = options.columns ?? defaultColumns;
  const windowSize = options.windowSize ?? defaultSpectrogramConfig.windowSize;
  const values = new Float32Array(Math.max(0, frameCount));
  const confidence = new Float32Array(values.length);
  const processor = createSpectrogramProcessor({
    device,
    config: {
      ...defaultSpectrogramConfig,
      canvas: new OffscreenCanvas(columns, 8),
      viewSize: { width: columns, height: 8 },
      visibleTime: (hop * (columns - 1)) / sampleRate,
      playheadRatio: 0,
      windowSize,
      zeroPaddingFactor:
        options.zeroPaddingFactor ?? defaultSpectrogramConfig.zeroPaddingFactor,
      lanes: {
        lead: {
          ...defaultSpectrogramConfig.lanes.lead,
          showSpectrogram: false,
          showFundamental: true,
          showNotes: false,
        },
        recording: {
          ...defaultSpectrogramConfig.lanes.recording,
          showSpectrogram: false,
          showFundamental: false,
          showNotes: false,
        },
      },
    },
  });
  try {
    for (let offset = 0; offset < values.length; offset += columns) {
      const baseColumn = firstFrame + offset;
      const progress = (baseColumn * hop + windowSize / 2) / samples.length;
      await renderUntilComplete(processor, samples, progress);
      const frames = await processor.readFundamentalFrames(
        'lead',
        baseColumn,
        columns,
      );
      if (!frames) {
        throw new Error('the fundamental frames were not rendered');
      }
      const count = Math.min(columns, values.length - offset);
      values.set(frames.values.subarray(0, count), offset);
      confidence.set(frames.confidence.subarray(0, count), offset);
    }
  } finally {
    processor.dispose();
  }
  return { hopSeconds: hop / sampleRate, firstFrame, values, confidence };
};
