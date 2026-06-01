export const allFourierModes = [
  'fftPackedFusedTiledR2c',
  'fftPackedStockhamR2c',
  'fftPackedTiledR2c',
  'fftPrunedFourStepR2c',
] as const;
export type FourierMode = (typeof allFourierModes)[number];

export const allWindowFunctionNames = [
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
export type WindowFunctionName = (typeof allWindowFunctionNames)[number];

export const allSpectrogramWindowNames = allWindowFunctionNames;
export type SpectrogramWindowName = WindowFunctionName;
