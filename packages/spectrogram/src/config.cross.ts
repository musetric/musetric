import { type FourierMode, type WindowFunctionName } from '@musetric/fft';
import { createObjectKeys, type ViewSize } from '@musetric/utils';
import { type SpectrogramColors } from './common/colors.es.js';
import { extractConfig } from './common/config.es.js';
import { allTrackKeys, type TrackKey } from './common/trackKeys.es.js';

export type SpectrogramCursorHarmonic = {
  fundamental: number;
  dominant: number;
};

export type SpectrogramCursorHarmonics = Record<
  TrackKey,
  SpectrogramCursorHarmonic
>;

export type SpectrogramZeroPaddingFactor = 1 | 2 | 4;

export type SpectrogramLaneConfig = {
  showSpectrogram: boolean;
  showFundamental: boolean;
  showNotes: boolean;
  lineWidthCents: number;
  truncateAfterPlayhead: boolean;
  gainDb: number;
  sourceStretch: number;
  transposeSemitones: number;
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
};

export type SpectrogramHarmonicsConfig = {
  enabled: boolean;
  dominantMaxFrequency: number;
  dominantSearchCents: number;
  dominantMarginDb: number;
  ridgeHalfWidthCents: number;
  smoothingColumns: number;
  ringMinFrequency: number;
  ringMaxFrequency: number;
  ringAmount: number;
};

export type SpectrogramStencilConfig = {
  enabled: boolean;
  opacity: number;
  harmonicCount: number;
  lineWidthPixels: number;
  overtoneFade: number;
  octaveShift: number;
};

export type SpectrogramHarmonicComparisonConfig = {
  enabled: boolean;
  pitchToleranceCents: number;
  neutralDb: number;
  fullDb: number;
  floorDb: number;
  maxHarmonics: number;
  missingAmount: number;
};

export type SpectrogramComparison = {
  reference: TrackKey;
  target: TrackKey;
  matchThresholdCents: number;
  closeThresholdCents: number;
  missThresholdCents: number;
  colorWindowLeftSeconds: number;
  colorWindowRightSeconds: number;
  colorFalloffSigmaSeconds: number;
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
  harmonics: SpectrogramHarmonicsConfig;
  harmonicComparison: SpectrogramHarmonicComparisonConfig;
  stencil: SpectrogramStencilConfig;
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
  'harmonics',
  'harmonicComparison',
  'stencil',
]);

export const extractSpectrogramConfig = (config: Partial<SpectrogramConfig>) =>
  extractConfig<SpectrogramConfig>(config, allSpectrogramConfigKeys);

const isFundamentalShown = (lane: SpectrogramLaneConfig): boolean =>
  lane.showFundamental || lane.showNotes;

export const isFundamentalNeeded = (
  config: Pick<SpectrogramConfig, 'lanes' | 'comparison'>,
  key: TrackKey,
): boolean =>
  isFundamentalShown(config.lanes[key]) ||
  (key === config.comparison.reference &&
    isFundamentalShown(config.lanes[config.comparison.target]));

export const areHarmonicsShown = (
  config: Pick<SpectrogramConfig, 'harmonics' | 'lanes'>,
): boolean =>
  config.harmonics.enabled &&
  allTrackKeys.some((key) => config.lanes[key].showSpectrogram);

export const isStencilShown = (
  config: Pick<SpectrogramConfig, 'stencil' | 'lanes'>,
): boolean =>
  config.stencil.enabled &&
  config.stencil.opacity > 0 &&
  allTrackKeys.every((key) => config.lanes[key].showSpectrogram);

export const isHarmonicComparisonShown = (
  config: Pick<SpectrogramConfig, 'harmonicComparison' | 'lanes'>,
): boolean =>
  config.harmonicComparison.enabled &&
  allTrackKeys.every((key) => config.lanes[key].showSpectrogram);

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
