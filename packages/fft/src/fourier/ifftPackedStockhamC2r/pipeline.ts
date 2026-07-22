import { multiPassPairStageShader } from './multiPassPairStage.wgsl.js';
import { multiPassStageShader } from './multiPassStage.wgsl.js';
import {
  type PackedStockhamC2rKernel,
  type PackedStockhamC2rVariant,
} from './support.js';
import { transformShader } from './transform.wgsl.js';
import { transformInPlaceMixedShader } from './transformInPlaceMixed.wgsl.js';

type TransformStageCounts = {
  radix8StageCount: number;
  radix4StageCount: number;
  radix2StageCount: number;
  radix3StageCount: number;
  radix5StageCount: number;
};

const stageCount = (counts: TransformStageCounts): number =>
  counts.radix8StageCount +
  counts.radix4StageCount +
  counts.radix2StageCount +
  counts.radix3StageCount +
  counts.radix5StageCount;

const isPowerOfTwo = (value: number): boolean => (value & (value - 1)) === 0;

const createRadix8PreferredCounts = (
  packedWindowSize: number,
): TransformStageCounts => {
  let remaining = packedWindowSize;
  const counts: TransformStageCounts = {
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
  return counts;
};

const selectTransformStageCounts = (
  variant: Extract<
    PackedStockhamC2rVariant,
    { kind: 'singlePass' | 'inPlaceMixed' }
  >,
): TransformStageCounts =>
  createRadix8PreferredCounts(variant.packedWindowSize);

const selectTransformThreadCount = (
  variant: Extract<
    PackedStockhamC2rVariant,
    { kind: 'singlePass' | 'inPlaceMixed' }
  >,
  counts: TransformStageCounts,
): number => {
  if (variant.kind === 'inPlaceMixed') {
    if (isPowerOfTwo(variant.packedWindowSize)) {
      return 256;
    }
    return stageCount(counts) <= 4 ? 128 : 256;
  }
  if (variant.packedWindowSize <= 768) {
    return 64;
  }
  if (variant.packedWindowSize <= 1024) {
    return 128;
  }
  return 256;
};

const createTransformConstants = (
  variant: Extract<
    PackedStockhamC2rVariant,
    { kind: 'singlePass' | 'inPlaceMixed' }
  >,
  inPlace: boolean,
) => {
  const counts = selectTransformStageCounts(variant);
  return {
    packedWindowSize: variant.packedWindowSize,
    positiveWindowSize: variant.positiveWindowSize,
    inPlace: inPlace ? 1 : 0,
    threadCount: selectTransformThreadCount(variant, counts),
    ...counts,
  };
};

const createKernelConstants = (
  variant: Extract<PackedStockhamC2rVariant, { kind: 'multiPass' }>,
  kernel: PackedStockhamC2rKernel,
  inPlace: boolean,
): Record<string, number> => {
  const base = {
    packedWindowSize: variant.packedWindowSize,
    stageStride: kernel.stageStride,
    readBufferIndex: kernel.readBufferIndex,
    writeBufferIndex: kernel.writeBufferIndex,
    readFromPrepack: kernel.readFromPrepack ? 1 : 0,
    writeToSignal: kernel.writeToSignal ? 1 : 0,
    inPlace: inPlace ? 1 : 0,
    threadCount: kernel.threadCount,
  };
  if (kernel.kind === 'pair') {
    const groupsPerWorkgroup = kernel.threadCount / 8;
    return {
      ...base,
      factor1: kernel.factor1,
      factor2: kernel.factor2,
      groupsPerWorkgroup,
      pairSharedSize: groupsPerWorkgroup * kernel.factor1 * kernel.factor2,
    };
  }
  return {
    ...base,
    factor: kernel.factor,
  };
};

export type SinglePassPipeline = {
  kind: 'singlePass';
  transform: GPUComputePipeline;
};

const createSinglePassPipeline = (
  device: GPUDevice,
  variant: Extract<
    PackedStockhamC2rVariant,
    { kind: 'singlePass' | 'inPlaceMixed' }
  >,
  inPlace: boolean,
): SinglePassPipeline => {
  const module = device.createShaderModule({
    label: 'packed-stockham-c2r-transform-shader',
    code:
      variant.kind === 'inPlaceMixed'
        ? transformInPlaceMixedShader
        : transformShader,
  });
  return {
    kind: 'singlePass',
    transform: device.createComputePipeline({
      label: 'packed-stockham-c2r-transform-pipeline',
      layout: 'auto',
      compute: {
        module,
        entryPoint: 'main',
        constants: createTransformConstants(variant, inPlace),
      },
    }),
  };
};

export type MultiPassPipeline = {
  kind: 'multiPass';
  stages: GPUComputePipeline[];
};

const createMultiPassPipeline = (
  device: GPUDevice,
  variant: Extract<PackedStockhamC2rVariant, { kind: 'multiPass' }>,
  inPlace: boolean,
): MultiPassPipeline => {
  const stageModule = device.createShaderModule({
    label: 'packed-stockham-c2r-multipass-stage-shader',
    code: multiPassStageShader,
  });
  const pairModule = device.createShaderModule({
    label: 'packed-stockham-c2r-multipass-pair-stage-shader',
    code: multiPassPairStageShader,
  });

  return {
    kind: 'multiPass',
    stages: variant.kernels.map((kernel) =>
      device.createComputePipeline({
        label: 'packed-stockham-c2r-multipass-stage-pipeline',
        layout: 'auto',
        compute: {
          module: kernel.kind === 'pair' ? pairModule : stageModule,
          entryPoint: 'main',
          constants: createKernelConstants(variant, kernel, inPlace),
        },
      }),
    ),
  };
};

export type Pipeline = SinglePassPipeline | MultiPassPipeline;

export const createPipeline = (
  device: GPUDevice,
  variant: PackedStockhamC2rVariant,
  inPlace: boolean,
): Pipeline => {
  if (variant.kind === 'multiPass') {
    return createMultiPassPipeline(device, variant, inPlace);
  }
  return createSinglePassPipeline(device, variant, inPlace);
};
