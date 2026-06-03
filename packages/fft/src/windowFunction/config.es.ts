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
