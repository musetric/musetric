export type RadixStage = 2 | 3 | 4 | 5;

export type RadixStageCounts = {
  radix4StageCount: number;
  radix2StageCount: number;
  radix3StageCount: number;
  radix5StageCount: number;
};

export const createRadixStages = (
  size: number,
): RadixStageCounts | undefined => {
  if (!Number.isInteger(size) || size < 1) {
    return undefined;
  }

  let remaining = size;
  let radix4StageCount = 0;
  let radix2StageCount = 0;
  let radix3StageCount = 0;
  let radix5StageCount = 0;

  while (remaining % 4 === 0) {
    radix4StageCount++;
    remaining /= 4;
  }
  while (remaining % 2 === 0) {
    radix2StageCount++;
    remaining /= 2;
  }
  while (remaining % 3 === 0) {
    radix3StageCount++;
    remaining /= 3;
  }
  while (remaining % 5 === 0) {
    radix5StageCount++;
    remaining /= 5;
  }

  return remaining === 1
    ? {
        radix4StageCount,
        radix2StageCount,
        radix3StageCount,
        radix5StageCount,
      }
    : undefined;
};

export const expandRadixStages = (stages: RadixStageCounts): RadixStage[] => [
  ...new Array<RadixStage>(stages.radix4StageCount).fill(4),
  ...new Array<RadixStage>(stages.radix2StageCount).fill(2),
  ...new Array<RadixStage>(stages.radix3StageCount).fill(3),
  ...new Array<RadixStage>(stages.radix5StageCount).fill(5),
];

export type MultiPassRadixStage = RadixStage | 8;

// Greedy radix-8-preferring stage list (then 4, 2, 3, 5) to minimise the
// number of global-memory passes in the multi-pass pipelines.
export const expandRadix8PreferredStages = (
  size: number,
): MultiPassRadixStage[] | undefined => {
  const stages: MultiPassRadixStage[] = [];
  let remaining = size;
  for (const factor of [8, 4, 2, 3, 5] as const) {
    while (remaining % factor === 0) {
      stages.push(factor);
      remaining /= factor;
    }
  }
  return remaining === 1 ? stages : undefined;
};
