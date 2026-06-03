export const isPowerOfTwo = (value: number): boolean =>
  value > 1 && Number.isInteger(Math.log2(value));

export const assertWindowSizePowerOfTwo = (windowSize: number): void => {
  if (!isPowerOfTwo(windowSize)) {
    throw new Error(
      `FFT size must be a power of two and bigger than 1, got ${windowSize}`,
    );
  }
};
