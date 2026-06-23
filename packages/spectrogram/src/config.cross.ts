import { type FourierMode, type WindowFunctionName } from '@musetric/fft';
import { createObjectKeys, type ViewSize } from '@musetric/resource-utils';
import { type SpectrogramColors } from './common/colors.es.js';
import { extractConfig } from './common/config.es.js';

export const allTrackKeys = ['lead', 'recording'] as const;
export type TrackKey = (typeof allTrackKeys)[number];

export type SpectrogramZeroPaddingFactor = 1 | 2 | 4;

export type SpectrogramLaneConfig = {
  showSpectrogram: boolean;
  showFundamental: boolean;
  lineWidthCents: number;
  truncateAfterPlayhead: boolean;
  gainDb: number;
};

export type SpectrogramSpectralBand = {
  label: string;
  windowSize: number;
  minFrequency: number;
  fullMinFrequency: number;
  fullMaxFrequency: number;
  maxFrequency: number;
};

export const defaultSpectrogramSpectralBands: SpectrogramSpectralBand[] = [
  {
    label: '4096',
    windowSize: 4096,
    minFrequency: 20,
    fullMinFrequency: 20,
    fullMaxFrequency: 300,
    maxFrequency: 900,
  },
  {
    label: '2048',
    windowSize: 2048,
    minFrequency: 300,
    fullMinFrequency: 900,
    fullMaxFrequency: 2200,
    maxFrequency: 4200,
  },
  {
    label: '1024',
    windowSize: 1024,
    minFrequency: 2200,
    fullMinFrequency: 4200,
    fullMaxFrequency: 20_000,
    maxFrequency: 20_000,
  },
];

export type SpectrogramComparison = {
  reference: TrackKey;
  target: TrackKey;
  matchThresholdCents: number;
  closeThresholdCents: number;
};

export type SpectrogramConfig = {
  canvas: OffscreenCanvas;
  fourierMode: FourierMode;
  windowSize: number;
  sampleRate: number;
  visibleTime: number;
  playheadRatio: number;
  zeroPaddingFactor: SpectrogramZeroPaddingFactor;
  spectralBands: SpectrogramSpectralBand[];
  windowName: WindowFunctionName;
  minDecibel: number;
  minFrequency: number;
  maxFrequency: number;
  viewSize: ViewSize;
  colors: SpectrogramColors;
  lanes: Record<TrackKey, SpectrogramLaneConfig>;
  comparison: SpectrogramComparison;
};
export const allSpectrogramConfigKeys = createObjectKeys<SpectrogramConfig>()([
  'canvas',
  'fourierMode',
  'windowSize',
  'sampleRate',
  'visibleTime',
  'playheadRatio',
  'zeroPaddingFactor',
  'spectralBands',
  'windowName',
  'minDecibel',
  'minFrequency',
  'maxFrequency',
  'viewSize',
  'colors',
  'lanes',
  'comparison',
]);

export const extractSpectrogramConfig = (config: Partial<SpectrogramConfig>) =>
  extractConfig<SpectrogramConfig>(config, allSpectrogramConfigKeys);

const isConfigComplete = (
  config: Partial<SpectrogramConfig>,
): config is SpectrogramConfig =>
  allSpectrogramConfigKeys.every((key) => config[key] !== undefined);

const normalizeSpectrogramConfig = (
  config: SpectrogramConfig,
): SpectrogramConfig => ({
  ...config,
  spectralBands: config.spectralBands.length
    ? config.spectralBands
    : defaultSpectrogramSpectralBands,
});

export const buildSpectrogramConfig = (
  base?: SpectrogramConfig,
  draft?: Partial<SpectrogramConfig>,
) => {
  if (!draft) {
    return base;
  }

  if (!base) {
    if (!isConfigComplete(draft)) {
      return undefined;
    }
    return normalizeSpectrogramConfig(draft);
  }

  return normalizeSpectrogramConfig({
    ...base,
    ...draft,
  });
};
