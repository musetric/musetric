import { type FourierConfig } from '../config.es.js';
import {
  createRadixStages,
  expandRadixStages,
  type RadixStage,
} from '../factorization.es.js';

export type ScratchBufferIndex = 0 | 1;

export type PackedStockhamR2cStage = {
  factor: RadixStage;
  stageStride: number;
  readFromInput: boolean;
  readBufferIndex: ScratchBufferIndex;
  writeBufferIndex: ScratchBufferIndex;
  workgroupCount: number;
};

type BaseVariant = {
  windowSize: number;
  packedWindowSize: number;
  log2PackedWindowSize: number;
};

export type PackedStockhamR2cVariant =
  | (BaseVariant & { kind: 'stockham' | 'inPlaceRadix4' })
  | (BaseVariant & {
      kind: 'multiPass';
      stages: PackedStockhamR2cStage[];
      finalReadBufferIndex: ScratchBufferIndex;
    });

const minPackedWindowSize = 2;
const multiPassThreadCount = 64;

const isPowerOfTwo = (value: number): boolean =>
  Number.isInteger(Math.log2(value));

// One compute dispatch per radix stage, ping-ponging through two global scratch
// buffers. Works for any factorization and any size, so it carries the whole
// non-power-of-two (radix-3/5) range without a shared-memory size limit.
const createMultiPassStages = (
  packedWindowSize: number,
  radixStageList: readonly RadixStage[],
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

  return stages;
};

export const getPackedStockhamR2cVariant = (
  device: GPUDevice,
  config: FourierConfig,
): PackedStockhamR2cVariant | undefined => {
  const packedWindowSize = config.windowSize / 2;
  if (
    !Number.isInteger(packedWindowSize) ||
    packedWindowSize < minPackedWindowSize ||
    createRadixStages(packedWindowSize) === undefined
  ) {
    return undefined;
  }

  const log2PackedWindowSize = Math.log2(packedWindowSize);

  // Power-of-two sizes keep the original radix-2 single-pass / radix-4 in-place
  // shaders untouched.
  if (isPowerOfTwo(packedWindowSize)) {
    const maxStockhamPackedWindowSize = Math.floor(
      device.limits.maxComputeWorkgroupStorageSize / 16,
    );
    if (packedWindowSize <= maxStockhamPackedWindowSize) {
      return {
        kind: 'stockham',
        windowSize: config.windowSize,
        packedWindowSize,
        log2PackedWindowSize,
      };
    }

    const maxInPlacePackedWindowSize = Math.floor(
      device.limits.maxComputeWorkgroupStorageSize / 8,
    );
    if (
      packedWindowSize <= maxInPlacePackedWindowSize &&
      log2PackedWindowSize % 2 === 0
    ) {
      return {
        kind: 'inPlaceRadix4',
        windowSize: config.windowSize,
        packedWindowSize,
        log2PackedWindowSize,
      };
    }

    return undefined;
  }

  // Non-power-of-two (radix-3/5) sizes run through the generic multi-pass path.
  const radixStageCounts = createRadixStages(packedWindowSize);
  if (radixStageCounts === undefined) {
    return undefined;
  }
  const stages = createMultiPassStages(
    packedWindowSize,
    expandRadixStages(radixStageCounts),
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
    stages,
    finalReadBufferIndex: stages[stages.length - 1].writeBufferIndex,
  };
};
