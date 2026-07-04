import { type SpectrogramConfig } from '../config.cross.js';

export type SpectrogramSampleRange = {
  frameIndex: number;
  frameCount: number;
};

export const computeColumnStep = (
  config: Pick<SpectrogramConfig, 'visibleTime' | 'sampleRate'> & {
    windowCount: number;
  },
): number => {
  const divisor = Math.max(1, config.windowCount - 1);
  return (config.visibleTime * config.sampleRate) / divisor;
};

export const floorMod = (value: number, modulus: number): number =>
  ((value % modulus) + modulus) % modulus;

export type ExtSpectrogramConfig = SpectrogramConfig & {
  windowCount: number;

  columnStep: number;
};

export const computeBaseColumn = (
  config: ExtSpectrogramConfig,
  trackProgress: number,
  sampleLength: number,
): number => {
  const beforePlayhead =
    config.visibleTime * config.playheadRatio * config.sampleRate;
  const anchor =
    trackProgress * sampleLength - beforePlayhead - config.windowSize / 2;
  return Math.round(anchor / config.columnStep);
};

export const windowStartForColumn = (
  config: Pick<ExtSpectrogramConfig, 'columnStep'>,
  bandWindowSize: number,
  column: number,
): number => Math.round(column * config.columnStep - bandWindowSize / 2);

export type SpectrogramColumnRange = {
  screenBase: number;
  slotOffset: number;
  columnCount: number;
};

export const fullColumnRange = (
  config: ExtSpectrogramConfig,
  baseColumn: number,
): SpectrogramColumnRange => ({
  screenBase: 0,
  slotOffset: floorMod(baseColumn, config.windowCount),
  columnCount: config.windowCount,
});
