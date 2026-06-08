import { createRadixStages } from '../factorization.es.js';

const maxFormattedPowerOfTwo = 1024;

export const formatRadixStages = (size: number, separator = '·'): string => {
  const stages = createRadixStages(size);
  if (stages === undefined) {
    return String(size);
  }

  let powerOfTwoCount = stages.radix4StageCount * 2 + stages.radix2StageCount;
  if (
    powerOfTwoCount + stages.radix3StageCount + stages.radix5StageCount ===
    0
  ) {
    return '1';
  }

  const parts: number[] = [];

  while (powerOfTwoCount > 0) {
    const chunk = Math.min(powerOfTwoCount, Math.log2(maxFormattedPowerOfTwo));
    parts.push(2 ** chunk);
    powerOfTwoCount -= chunk;
  }
  for (let index = 0; index < stages.radix3StageCount; index++) {
    parts.push(3);
  }
  for (let index = 0; index < stages.radix5StageCount; index++) {
    parts.push(5);
  }

  return parts.join(separator);
};
