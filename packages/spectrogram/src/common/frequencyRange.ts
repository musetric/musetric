import { createNumberLimit } from '@musetric/utils';

export const minimumSpectrogramFrequency = 16.351597831287414;
export const maximumSpectrogramFrequency = 20_000;
export const minimumSpectrogramFrequencyRatio = 2;

export const normalizeSpectrogramMinFrequency = (
  minFrequency: number,
  maxFrequency: number,
) => {
  const limit = createNumberLimit({
    minimum: minimumSpectrogramFrequency,
    maximum: maxFrequency / minimumSpectrogramFrequencyRatio,
  });
  return limit.clamp(minFrequency);
};

export const normalizeSpectrogramMaxFrequency = (
  maxFrequency: number,
  minFrequency: number,
) => {
  const limit = createNumberLimit({
    minimum: minFrequency * minimumSpectrogramFrequencyRatio,
    maximum: maximumSpectrogramFrequency,
  });
  return limit.clamp(maxFrequency);
};
