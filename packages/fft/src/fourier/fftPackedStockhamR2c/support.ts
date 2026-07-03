import { type FourierConfig } from '../config.es.js';
import {
  createRadixStages,
  expandRadix8PreferredStages,
  type MultiPassRadixStage,
  type RadixStageCounts,
} from '../factorization.es.js';

export type ScratchBufferIndex = 0 | 1;

type MultiPassKernelBase = {
  stageStride: number;
  readFromInput: boolean;
  readBufferIndex: ScratchBufferIndex;
  writeBufferIndex: ScratchBufferIndex;
  workgroupCount: number;
  threadCount: number;
};

export type PackedStockhamR2cKernel =
  | (MultiPassKernelBase & {
      kind: 'single';
      factor: MultiPassRadixStage;
      fuseR2cPack: boolean;
    })
  | (MultiPassKernelBase & {
      kind: 'pair';
      factor1: MultiPassRadixStage;
      factor2: MultiPassRadixStage;
    });

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
      kernels: PackedStockhamR2cKernel[];
    });

const minPackedWindowSize = 2;
const pairThreadsPerGroup = 8;

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

const maxPairGroupSize = 64;

// Builds the kernel plan: adjacent stages with a combined group of at most 64
// points are fused into pair kernels (two stages through shared memory per
// global round trip); the last stage stays single because it fuses the R2C
// pack instead. Full radix-64 pairs and single stages measured fastest with
// 64-thread workgroups; narrower pairs (fewer butterflies per group set)
// prefer 128.
const selectPairThreadCount = (groupSize: number): number =>
  groupSize === 64 ? 64 : 128;

const createMultiPassKernels = (
  packedWindowSize: number,
  radixStageList: readonly MultiPassRadixStage[],
  maxComputeWorkgroupsPerDimension: number,
): PackedStockhamR2cKernel[] | undefined => {
  const kernels: PackedStockhamR2cKernel[] = [];
  let stageStride = 1;
  let stageIndex = 0;
  while (stageIndex < radixStageList.length) {
    const factor = radixStageList[stageIndex];
    const nextFactor =
      stageIndex + 1 < radixStageList.length - 1
        ? radixStageList[stageIndex + 1]
        : undefined;
    const kernelIndex = kernels.length;
    const readBufferIndex: ScratchBufferIndex = kernelIndex % 2 === 0 ? 1 : 0;
    const writeBufferIndex: ScratchBufferIndex = kernelIndex % 2 === 0 ? 0 : 1;
    const base = {
      stageStride,
      readFromInput: stageIndex === 0,
      readBufferIndex,
      writeBufferIndex,
    };

    if (nextFactor !== undefined && factor * nextFactor <= maxPairGroupSize) {
      const groupSize = factor * nextFactor;
      const groupCount = packedWindowSize / groupSize;
      const threadCount = selectPairThreadCount(groupSize);
      kernels.push({
        ...base,
        kind: 'pair',
        factor1: factor,
        factor2: nextFactor,
        threadCount,
        workgroupCount: Math.ceil(
          groupCount / (threadCount / pairThreadsPerGroup),
        ),
      });
      stageStride *= groupSize;
      stageIndex += 2;
      continue;
    }

    const isLast = stageIndex === radixStageList.length - 1;
    const singleThreadCount = 64;
    // The fused-pack last stage runs the butterfly pair (k, stageStride - k)
    // per thread, so it only needs threads for k in [0, stride / 2].
    const threadTotal = isLast
      ? Math.floor(packedWindowSize / factor / 2) + 1
      : packedWindowSize / factor;
    kernels.push({
      ...base,
      kind: 'single',
      factor,
      fuseR2cPack: isLast,
      threadCount: singleThreadCount,
      workgroupCount: Math.ceil(threadTotal / singleThreadCount),
    });
    stageStride *= factor;
    stageIndex += 1;
  }

  for (const kernel of kernels) {
    if (kernel.workgroupCount > maxComputeWorkgroupsPerDimension) {
      return undefined;
    }
  }

  return kernels;
};

export const getPackedStockhamR2cVariant = (
  device: GPUDevice,
  config: FourierConfig,
): PackedStockhamR2cVariant | undefined => {
  const packedWindowSize = config.windowSize / 2;
  const radixStageCounts = createRadixStages(packedWindowSize);
  if (
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
  const kernels = createMultiPassKernels(
    packedWindowSize,
    radixStageList,
    device.limits.maxComputeWorkgroupsPerDimension,
  );
  if (kernels === undefined) {
    return undefined;
  }

  return {
    kind: 'multiPass',
    windowSize: config.windowSize,
    packedWindowSize,
    log2PackedWindowSize,
    radixStageCounts,
    kernels,
  };
};
