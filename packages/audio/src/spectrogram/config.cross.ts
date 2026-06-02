import { type FourierMode, type SpectrogramWindowName } from '@musetric/fft';
import { createObjectKeys } from '@musetric/resource-utils';
import { type SpectrogramColors } from '../common/colors.es.js';
import { extractConfig } from '../common/config.es.js';
import { type ViewSize } from '../common/viewSize.es.js';

export const allTrackKeys = ['lead', 'recording'] as const;
export type TrackKey = (typeof allTrackKeys)[number];

export type SpectrogramZeroPaddingFactor = 1 | 2 | 4;

export type SpectrogramLaneConfig = {
  showSpectrogram: boolean;
  showFundamental: boolean;
  lineWidthCents: number;
  truncateAfterPlayhead: boolean;
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
  windowName: SpectrogramWindowName;
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
