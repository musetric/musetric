export const isPowerOfTwo = (value: number): boolean =>
  value > 0 && (value & (value - 1)) === 0;

export type Radix8PreferredStageCounts = {
  radix8StageCount: number;
  radix4StageCount: number;
  radix2StageCount: number;
  radix3StageCount: number;
  radix5StageCount: number;
};

export const createRadix8PreferredCounts = (
  size: number,
): Radix8PreferredStageCounts | undefined => {
  let remaining = size;
  const counts: Radix8PreferredStageCounts = {
    radix8StageCount: 0,
    radix4StageCount: 0,
    radix2StageCount: 0,
    radix3StageCount: 0,
    radix5StageCount: 0,
  };
  const factors = [
    [8, 'radix8StageCount'],
    [4, 'radix4StageCount'],
    [2, 'radix2StageCount'],
    [3, 'radix3StageCount'],
    [5, 'radix5StageCount'],
  ] as const;
  for (const [factor, key] of factors) {
    while (remaining % factor === 0) {
      counts[key]++;
      remaining /= factor;
    }
  }
  return remaining === 1 ? counts : undefined;
};

export type RadixStageCounts = {
  radix4StageCount: number;
  radix2StageCount: number;
  radix3StageCount: number;
  radix5StageCount: number;
};

export const createRadixStages = (
  size: number,
): RadixStageCounts | undefined => {
  if (size < 1) {
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

type RadixStage = 2 | 3 | 4 | 5;

export type MultiPassRadixStage = RadixStage | 8;

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
