export const normalizeSpectrogramMinFrequency = (
  minFrequency: number,
  maxFrequency: number,
) => {
  const availableMinFrequency = maxFrequency - 1;
  if (minFrequency >= availableMinFrequency) {
    return availableMinFrequency;
  }

  if (minFrequency < 1) {
    return 1;
  }

  return minFrequency;
};

export const normalizeSpectrogramMaxFrequency = (
  maxFrequency: number,
  minFrequency: number,
) => {
  const availableMaxFrequency = minFrequency + 1;
  if (maxFrequency <= availableMaxFrequency) {
    return availableMaxFrequency;
  }

  if (maxFrequency < 2) {
    return 2;
  }

  return maxFrequency;
};
