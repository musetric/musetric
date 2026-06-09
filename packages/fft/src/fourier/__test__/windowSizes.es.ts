export const createWindowSizes = (min: number, max: number): number[] => {
  const windowSizes: number[] = [];
  const multipliers = [1, 3, 5, 3 * 5];

  for (let powerOfTwo = 1; powerOfTwo <= max; powerOfTwo *= 2) {
    for (const multiplier of multipliers) {
      const windowSize = powerOfTwo * multiplier;
      if (windowSize >= min && windowSize <= max) {
        windowSizes.push(windowSize);
      }
    }
  }

  return [...windowSizes].sort((left, right) => left - right);
};
