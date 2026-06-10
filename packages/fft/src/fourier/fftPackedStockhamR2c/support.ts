import { type FourierConfig } from '../config.es.js';
import {
  createRadixStages,
  expandRadix8PreferredStages,
  type MultiPassRadixStage,
  type RadixStageCounts,
} from '../factorization.es.js';

export type ScratchBufferIndex = 0 | 1;

export type PackedStockhamR2cStage = {
  factor: MultiPassRadixStage;
  stageStride: number;
  readFromInput: boolean;
  readBufferIndex: ScratchBufferIndex;
  writeBufferIndex: ScratchBufferIndex;
  workgroupCount: number;
};

export type InPlaceMixedStageCounts = {
  radix8StageCount: number;
  radix4StageCount: number;
  radix2StageCount: number;
  radix3StageCount: number;
  radix5StageCount: number;
};

type PackedStockhamR2cBaseVariant = {
  windowSize: number;
  packedWindowSize: number;
  log2PackedWindowSize: number;
  radixStageCounts: RadixStageCounts;
};

export type PackedStockhamR2cVariant =
  | (PackedStockhamR2cBaseVariant & {
      kind: 'stockham' | 'inPlaceRadix4';
    })
  | (PackedStockhamR2cBaseVariant & {
      kind: 'inPlaceMixed';
      inPlaceStageCounts: InPlaceMixedStageCounts;
    })
  | (PackedStockhamR2cBaseVariant & {
      kind: 'multiPass';
      stages: PackedStockhamR2cStage[];
      finalReadBufferIndex: ScratchBufferIndex;
    });

const minPackedWindowSize = 2;
const multiPassThreadCount = 64;

const isPowerOfTwo = (value: number): boolean =>
  Number.isInteger(Math.log2(value));

// Greedy radix-8-preferring factorization (then 4, 2, 3, 5) used by the
// in-place single-pass kernel to minimise the stage/barrier count.
const createRadix8PreferredCounts = (
  packedWindowSize: number,
): InPlaceMixedStageCounts | undefined => {
  let remaining = packedWindowSize;
  const counts = {
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

const createMultiPassStages = (
  packedWindowSize: number,
  radixStageList: readonly MultiPassRadixStage[],
  maxComputeWorkgroupsPerDimension: number,
): PackedStockhamR2cStage[] | undefined => {
  const stages: PackedStockhamR2cStage[] = [];
  let stageStride = 1;
  for (const [stageIndex, factor] of radixStageList.entries()) {
    const butterflyCount = packedWindowSize / factor;
    const workgroupCount = Math.ceil(butterflyCount / multiPassThreadCount);
    if (workgroupCount > maxComputeWorkgroupsPerDimension) {
      return undefined;
    }

    stages.push({
      factor,
      stageStride,
      readFromInput: stageIndex === 0,
      readBufferIndex: stageIndex % 2 === 0 ? 1 : 0,
      writeBufferIndex: stageIndex % 2 === 0 ? 0 : 1,
      workgroupCount,
    });
    stageStride *= factor;
  }

  // The last stage fuses the R2C pack: one thread runs the butterfly pair
  // (k, stageStride - k), so it only needs threads for k in [0, stride / 2].
  const lastStage = stages[stages.length - 1];
  lastStage.workgroupCount = Math.ceil(
    (Math.floor(lastStage.stageStride / 2) + 1) / multiPassThreadCount,
  );

  return stages;
};

export const getPackedStockhamR2cVariant = (
  device: GPUDevice,
  config: FourierConfig,
): PackedStockhamR2cVariant | undefined => {
  const packedWindowSize = config.windowSize / 2;
  const radixStageCounts = createRadixStages(packedWindowSize);
  if (
    !Number.isInteger(packedWindowSize) ||
    radixStageCounts === undefined ||
    packedWindowSize < minPackedWindowSize
  ) {
    return undefined;
  }

  const maxStockhamPackedWindowSize = Math.floor(
    device.limits.maxComputeWorkgroupStorageSize / 16,
  );
  if (packedWindowSize <= maxStockhamPackedWindowSize) {
    return {
      kind: 'stockham',
      windowSize: config.windowSize,
      packedWindowSize,
      log2PackedWindowSize: Math.log2(packedWindowSize),
      radixStageCounts,
    };
  }

  const log2PackedWindowSize = Math.log2(packedWindowSize);
  const maxInPlacePackedWindowSize = Math.floor(
    device.limits.maxComputeWorkgroupStorageSize / 8,
  );
  if (
    isPowerOfTwo(packedWindowSize) &&
    packedWindowSize <= maxInPlacePackedWindowSize &&
    log2PackedWindowSize % 2 === 0
  ) {
    return {
      kind: 'inPlaceRadix4',
      windowSize: config.windowSize,
      packedWindowSize,
      log2PackedWindowSize,
      radixStageCounts,
    };
  }

  // Non-power-of-two sizes that still fit a single shared buffer (8 B/elem) run
  // as an in-place mixed-radix single pass instead of the global-memory-bound
  // multi-pass path, keeping the whole transform resident in shared memory.
  const inPlaceStageCounts = createRadix8PreferredCounts(packedWindowSize);
  if (
    packedWindowSize <= maxInPlacePackedWindowSize &&
    inPlaceStageCounts !== undefined
  ) {
    return {
      kind: 'inPlaceMixed',
      windowSize: config.windowSize,
      packedWindowSize,
      log2PackedWindowSize,
      radixStageCounts,
      inPlaceStageCounts,
    };
  }

  const radixStageList = expandRadix8PreferredStages(packedWindowSize);
  if (radixStageList === undefined) {
    return undefined;
  }
  const stages = createMultiPassStages(
    packedWindowSize,
    radixStageList,
    device.limits.maxComputeWorkgroupsPerDimension,
  );
  if (stages === undefined) {
    return undefined;
  }

  return {
    kind: 'multiPass',
    windowSize: config.windowSize,
    packedWindowSize,
    log2PackedWindowSize,
    radixStageCounts,
    stages,
    finalReadBufferIndex: stages[stages.length - 1].writeBufferIndex,
  };
};
