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

export type SpectrogramVisualConfig = {
  gateFloorDb: number;
  gateRangeDb: number;
  frequencyTiltSlope: number;
  frequencyTiltMinGain: number;
  frequencyTiltMaxGain: number;
  displayGamma: number;
  rowNormalizationStrength: number;
  rowNormalizationFloorFactor: number;
  rowNormalizationMinRange: number;
};

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
  visual: SpectrogramVisualConfig;
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
  'visual',
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
    return draft;
  }

  return {
    ...base,
    ...draft,
  };
};
