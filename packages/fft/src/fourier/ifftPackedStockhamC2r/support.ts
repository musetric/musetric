import { type FourierConfig } from '../config.es.js';
import {
  createRadixStages,
  expandRadixStages,
  type RadixStage,
  type RadixStageCounts,
} from '../factorization.es.js';

export type ScratchBufferIndex = 0 | 1;

export type PackedStockhamC2rStage = {
  factor: RadixStage;
  stageStride: number;
  readBufferIndex: ScratchBufferIndex;
  writeBufferIndex: ScratchBufferIndex;
  workgroupCount: number;
};

type BaseVariant = {
  windowSize: number;
  packedWindowSize: number;
  positiveWindowSize: number;
};

export type PackedStockhamC2rVariant =
  | (BaseVariant & {
      kind: 'singlePass' | 'inPlaceMixed';
      radixStageCounts: RadixStageCounts;
    })
  | (BaseVariant & {
      kind: 'multiPass';
      stages: PackedStockhamC2rStage[];
      prepackWriteBufferIndex: ScratchBufferIndex;
      finalReadBufferIndex: ScratchBufferIndex;
    });

const multiPassThreadCount = 64;

const createMultiPassStages = (
  packedWindowSize: number,
  radixStageList: readonly RadixStage[],
  maxComputeWorkgroupsPerDimension: number,
): PackedStockhamC2rStage[] | undefined => {
  const stages: PackedStockhamC2rStage[] = [];
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
      readBufferIndex: stageIndex % 2 === 0 ? 1 : 0,
      writeBufferIndex: stageIndex % 2 === 0 ? 0 : 1,
      workgroupCount,
    });
    stageStride *= factor;
  }

  return stages;
};

export const getPackedStockhamC2rVariant = (
  device: GPUDevice,
  config: FourierConfig,
): PackedStockhamC2rVariant | undefined => {
  const packedWindowSize = config.windowSize / 2;
  const radixStageCounts = createRadixStages(packedWindowSize);
  if (
    !Number.isInteger(packedWindowSize) ||
    packedWindowSize < 2 ||
    radixStageCounts === undefined
  ) {
    return undefined;
  }

  const base: BaseVariant = {
    windowSize: config.windowSize,
    packedWindowSize,
    positiveWindowSize: packedWindowSize + 1,
  };

  // Any factorization that fits the ping-pong shared budget (16 B/elem) runs
  // the generic mixed-radix single-pass inverse.
  const maxSinglePassPacked = Math.floor(
    device.limits.maxComputeWorkgroupStorageSize / 16,
  );
  if (packedWindowSize <= maxSinglePassPacked) {
    return { kind: 'singlePass', ...base, radixStageCounts };
  }

  // Sizes that still fit one shared buffer (8 B/elem) run an in-place
  // mixed-radix single pass instead of the global multi-pass path.
  const maxInPlacePacked = Math.floor(
    device.limits.maxComputeWorkgroupStorageSize / 8,
  );
  if (packedWindowSize <= maxInPlacePacked) {
    return { kind: 'inPlaceMixed', ...base, radixStageCounts };
  }

  // Larger sizes run a generic multi-pass inverse through two global scratch
  // buffers.
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
    ...base,
    stages,
    prepackWriteBufferIndex: stages[0].readBufferIndex,
    finalReadBufferIndex: stages[stages.length - 1].writeBufferIndex,
  };
};
