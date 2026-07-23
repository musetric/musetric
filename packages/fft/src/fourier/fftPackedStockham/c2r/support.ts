import { type FourierConfig } from '../../config.es.js';
import {
  createRadixStages,
  expandRadix8PreferredStages,
  type MultiPassRadixStage,
  type RadixStageCounts,
} from '../../factorization.es.js';

const pairThreadsPerGroup = 8;
const maxPairGroupSize = 64;

const selectPairThreadCount = (groupSize: number): number =>
  groupSize === 64 ? 64 : 128;

export type ScratchBufferIndex = 0 | 1;

type MultiPassKernelBase = {
  stageStride: number;
  readFromPrepack: boolean;
  writeToSignal: boolean;
  readBufferIndex: ScratchBufferIndex;
  writeBufferIndex: ScratchBufferIndex;
  workgroupCount: number;
  threadCount: number;
};

export type PackedStockhamC2rKernel =
  | (MultiPassKernelBase & {
      kind: 'single';
      factor: MultiPassRadixStage;
    })
  | (MultiPassKernelBase & {
      kind: 'pair';
      factor1: MultiPassRadixStage;
      factor2: MultiPassRadixStage;
    });

const createMultiPassKernels = (
  packedWindowSize: number,
  radixStageList: readonly MultiPassRadixStage[],
  maxComputeWorkgroupsPerDimension: number,
): PackedStockhamC2rKernel[] | undefined => {
  const kernels: PackedStockhamC2rKernel[] = [];
  let stageStride = 1;
  let stageIndex = 0;
  while (stageIndex < radixStageList.length) {
    const factor = radixStageList[stageIndex];
    const nextFactor =
      stageIndex + 1 < radixStageList.length
        ? radixStageList[stageIndex + 1]
        : undefined;
    const kernelIndex = kernels.length;
    const readBufferIndex: ScratchBufferIndex = kernelIndex % 2 === 0 ? 1 : 0;
    const writeBufferIndex: ScratchBufferIndex = kernelIndex % 2 === 0 ? 0 : 1;
    const base = {
      stageStride,
      readFromPrepack: stageIndex === 0,
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
        writeToSignal: stageIndex + 2 === radixStageList.length,
        threadCount,
        workgroupCount: Math.ceil(
          groupCount / (threadCount / pairThreadsPerGroup),
        ),
      });
      stageStride *= groupSize;
      stageIndex += 2;
      continue;
    }

    const singleThreadCount = 64;
    kernels.push({
      ...base,
      kind: 'single',
      factor,
      writeToSignal: stageIndex === radixStageList.length - 1,
      threadCount: singleThreadCount,
      workgroupCount: Math.ceil(packedWindowSize / factor / singleThreadCount),
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
      kernels: PackedStockhamC2rKernel[];
    });

export const getPackedStockhamC2rVariant = (
  device: GPUDevice,
  config: FourierConfig,
): PackedStockhamC2rVariant | undefined => {
  const packedWindowSize = config.windowSize / 2;
  const radixStageCounts = createRadixStages(packedWindowSize);
  if (packedWindowSize < 2 || radixStageCounts === undefined) {
    return undefined;
  }

  const base: BaseVariant = {
    windowSize: config.windowSize,
    packedWindowSize,
    positiveWindowSize: packedWindowSize + 1,
  };

  const maxSinglePassPacked = Math.floor(
    device.limits.maxComputeWorkgroupStorageSize / 16,
  );
  if (packedWindowSize <= maxSinglePassPacked) {
    return { kind: 'singlePass', ...base, radixStageCounts };
  }

  const maxInPlacePacked = Math.floor(
    device.limits.maxComputeWorkgroupStorageSize / 8,
  );
  if (packedWindowSize <= maxInPlacePacked) {
    return { kind: 'inPlaceMixed', ...base, radixStageCounts };
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
    ...base,
    kernels,
  };
};
