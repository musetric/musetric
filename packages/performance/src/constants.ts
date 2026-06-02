import { type FourierMode } from '@musetric/fft';
import { defaultSampleRate } from '@musetric/resource-utils';
import { type SpectrogramZeroPaddingFactor } from '@musetric/spectrogram';

export const fourierModes: readonly FourierMode[] = [
  'fftPackedFusedTiledR2c',
  'fftPackedStockhamR2c',
  'fftPackedTiledR2c',
  'fftPrunedFourStepR2c',
];

export const warmupIters = 10;
export const measureIters = 30;
export const progress = 0.5;

const getWindowSizes = () => {
  const sizes: number[] = [];
  for (let size = 64; size <= 1024 * 8; size *= 2) {
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
export type VisibleTime = (typeof visibleTimes)[number];

export const zeroPaddingFactors = [
  1, 2, 4,
] as const satisfies readonly SpectrogramZeroPaddingFactor[];

export type BenchmarkParams = {
  viewSizeKey: ViewSizePresetKey;
  visibleTime: VisibleTime;
  zeroPaddingFactor: SpectrogramZeroPaddingFactor;
};

export const defaultBenchmarkParams: BenchmarkParams = {
  viewSizeKey: '1080p',
  visibleTime: 4,
  zeroPaddingFactor: 1,
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
