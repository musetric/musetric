import { type RadixStageCounts } from './factorization.es.js';

type RadixStageConstantsPrefix = 'row' | 'column';

export const createPrefixedRadixStageConstants = (
  stages: RadixStageCounts,
  prefix: RadixStageConstantsPrefix,
): Record<string, number> => {
  const keyPrefix = `${prefix}Radix`;

  return {
    [`${keyPrefix}4StageCount`]: stages.radix4StageCount,
    [`${keyPrefix}2StageCount`]: stages.radix2StageCount,
    [`${keyPrefix}3StageCount`]: stages.radix3StageCount,
    [`${keyPrefix}5StageCount`]: stages.radix5StageCount,
  };
};
