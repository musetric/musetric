import { createNumberLimit } from '@musetric/resource-utils';

/** C0 keeps the logarithmic scale in the musical range without negative MIDI notes */
export const minimumSpectrogramFrequency = 16.351597831287414;
/** 20 kHz is the practical upper bound of the human hearing range */
export const maximumSpectrogramFrequency = 20_000;
const minFrequencyDifference = 1;

export const normalizeSpectrogramMinFrequency = (
  minFrequency: number,
  maxFrequency: number,
) => {
  const limit = createNumberLimit({
    minimum: minimumSpectrogramFrequency,
    maximum: maxFrequency - minFrequencyDifference,
  });
  return limit.clamp(minFrequency);
};

export const normalizeSpectrogramMaxFrequency = (
  maxFrequency: number,
  minFrequency: number,
) => {
  const limit = createNumberLimit({
    minimum: minFrequency + minFrequencyDifference,
    maximum: maximumSpectrogramFrequency,
  });
  return limit.clamp(maxFrequency);
};
