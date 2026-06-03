export const allFourierModes = [
  'fftPackedFusedTiledR2c',
  'fftPackedStockhamR2c',
  'fftPackedTiledR2c',
  'fftPrunedFourStepR2c',
] as const;
export type FourierMode = (typeof allFourierModes)[number];

export type FourierConfig = {
  windowSize: number;
  windowCount: number;
};
