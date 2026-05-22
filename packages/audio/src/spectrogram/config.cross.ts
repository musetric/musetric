import { createObjectKeys } from '@musetric/resource-utils';
import { type ViewColors } from '../common/colors.es.js';
import { extractConfig } from '../common/config.es.js';
import { type ViewSize } from '../common/viewSize.es.js';

export type SpectrogramZeroPaddingFactor = 1 | 2 | 4;

export const allFourierModes = ['fftRadix2', 'fftRadix4'] as const;
export type FourierMode = (typeof allFourierModes)[number];

export const allSpectrogramWindowNames = [
  'bartlett',
  'bartlettHann',
  'blackman',
  'cosine',
  'gauss',
  'hamming',
  'hann',
  'lanczoz',
  'rectangular',
  'triangular',
] as const;
export type SpectrogramWindowName = (typeof allSpectrogramWindowNames)[number];

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
  colors: ViewColors;
  paddingLeftFactor: number;
  paddingRightFactor: number;
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
  'paddingLeftFactor',
  'paddingRightFactor',
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
