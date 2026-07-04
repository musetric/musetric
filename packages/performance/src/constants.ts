import { type FourierMode } from '@musetric/fft';
import {
  allTrackKeys,
  type SpectrogramZeroPaddingFactor,
  type TrackKey,
} from '@musetric/spectrogram';
import { defaultSampleRate } from '@musetric/utils';

export const fourierModes: readonly FourierMode[] = [
  'fftPackedStockhamR2c',
  'fftPackedTiledR2c',
];

export const warmupIters = 3;
export const benchBatchSize = 10;
export const benchMaxTries = 10;
export const benchStableCvPercent = 5;
export const progress = 0.5;

const getWindowSizes = () => {
  const sizes: number[] = [];
  for (let size = 256; size <= 1024 * 8; size *= 2) {
    sizes.push(size);
  }
  return sizes;
};
export const windowSizes = getWindowSizes();

export const viewSizePresets = {
  '480p': { width: 854, height: 480 },
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
} as const;
export type ViewSizePresetKey = keyof typeof viewSizePresets;
export const viewSizePresetKeys: readonly ViewSizePresetKey[] = [
  '480p',
  '720p',
  '1080p',
];

export const visibleTimes = [1, 4, 16] as const;
export type BenchmarkTrackScope = 'all' | TrackKey;
export const benchmarkTrackScopes: readonly BenchmarkTrackScope[] = [
  'all',
  ...allTrackKeys,
];

export type BenchmarkBandCount = 1 | 3;
export const benchmarkBandCounts: readonly BenchmarkBandCount[] = [1, 3];

export const zeroPaddingFactors = [
  1, 2, 4,
] as const satisfies readonly SpectrogramZeroPaddingFactor[];

export type VisibleTime = (typeof visibleTimes)[number];

export type BenchmarkParams = {
  viewSizeKey: ViewSizePresetKey;
  visibleTime: VisibleTime;
  trackScope: BenchmarkTrackScope;
  recordingSpectrogram: boolean;
  zeroPaddingFactor: SpectrogramZeroPaddingFactor;
  bandCount: BenchmarkBandCount;
};

export const defaultBenchmarkParams: BenchmarkParams = {
  viewSizeKey: '1080p',
  visibleTime: 4,
  trackScope: 'all',
  recordingSpectrogram: false,
  zeroPaddingFactor: 2,
  bandCount: 3,
};

const createSamples = () => {
  const result = new Float32Array(defaultSampleRate * 60 * 3);
  for (let i = 0; i < result.length; i++) {
    result[i] = Math.random() * 2 - 1;
  }
  return result;
};
export const samples = createSamples();
export const recordingSamples = createSamples();
