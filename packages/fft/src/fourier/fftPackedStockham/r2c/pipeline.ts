import { isPowerOfTwo } from '../../factorization.es.js';
import { multiPassPairStageShader } from './multiPassPairStage.wgsl.js';
import { multiPassStageShader } from './multiPassStage.wgsl.js';
import {
  type PackedStockhamR2cKernel,
  type PackedStockhamR2cVariant,
} from './support.js';
import { transformShader } from './transform.wgsl.js';
import { transformInPlaceMixedShader } from './transformInPlaceMixed.wgsl.js';
import { transformInPlaceRadix4Shader } from './transformInPlaceRadix4.wgsl.js';
import { transformInPlaceRadix8Shader } from './transformInPlaceRadix8.wgsl.js';

const selectStockhamThreadCount = (packedWindowSize: number): number => {
  if (packedWindowSize <= 768) {
    return 64;
  }
  if (packedWindowSize <= 1024) {
    return 128;
  }
  return 256;
};

const createRadix8StageCounts = (
  packedWindowSize: number,
): Record<string, number> => {
  const log2 = Math.round(Math.log2(packedWindowSize));
  const radix8StageCount = Math.floor(log2 / 3);
  const remainder = log2 - radix8StageCount * 3;
  return {
    radix8StageCount,
    radix4StageCount: remainder === 2 ? 1 : 0,
    radix2StageCount: remainder === 1 ? 1 : 0,
    radix3StageCount: 0,
    radix5StageCount: 0,
  };
};

const createStockhamConstants = (
  variant: PackedStockhamR2cVariant,
  inPlace: boolean,
) => ({
  packedWindowSize: variant.packedWindowSize,
  inPlace: inPlace ? 1 : 0,
  threadCount: selectStockhamThreadCount(variant.packedWindowSize),
  radix8StageCount: 0,
  ...variant.radixStageCounts,
  ...(isPowerOfTwo(variant.packedWindowSize)
    ? createRadix8StageCounts(variant.packedWindowSize)
    : {}),
});

const createInPlaceRadix4Constants = (
  variant: PackedStockhamR2cVariant,
  inPlace: boolean,
) => ({
  packedWindowSize: variant.packedWindowSize,
  log2PackedWindowSize: variant.log2PackedWindowSize,
  inPlace: inPlace ? 1 : 0,
  threadCount: selectStockhamThreadCount(variant.packedWindowSize),
});

const createInPlaceMixedConstants = (
  variant: Extract<PackedStockhamR2cVariant, { kind: 'inPlaceMixed' }>,
  inPlace: boolean,
) => {
  const counts = variant.inPlaceStageCounts;
  const stageCount =
    counts.radix8StageCount +
    counts.radix4StageCount +
    counts.radix2StageCount +
    counts.radix3StageCount +
    counts.radix5StageCount;
  const threadCount = stageCount <= 4 ? 128 : 256;
  return {
    packedWindowSize: variant.packedWindowSize,
    inPlace: inPlace ? 1 : 0,
    threadCount,
    ...counts,
  };
};

const createMultiPassKernelConstants = (
  variant: Extract<PackedStockhamR2cVariant, { kind: 'multiPass' }>,
  kernel: PackedStockhamR2cKernel,
  inPlace: boolean,
): Record<string, number> => {
  const base = {
    packedWindowSize: variant.packedWindowSize,
    inPlace: inPlace ? 1 : 0,
    stageStride: kernel.stageStride,
    readFromInput: kernel.readFromInput ? 1 : 0,
    readBufferIndex: kernel.readBufferIndex,
    writeBufferIndex: kernel.writeBufferIndex,
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
    fuseR2cPack: kernel.fuseR2cPack ? 1 : 0,
  };
};

export type SinglePassPipeline = {
  kind: 'stockham' | 'inPlaceRadix4' | 'inPlaceMixed';
  transform: GPUComputePipeline;
};

const createSinglePassPipeline = (
  device: GPUDevice,
  variant: Exclude<PackedStockhamR2cVariant, { kind: 'multiPass' }>,
  inPlace: boolean,
): SinglePassPipeline => {
  const isPowerOfEight =
    isPowerOfTwo(variant.packedWindowSize) &&
    variant.log2PackedWindowSize % 3 === 0;
  let shader = transformShader;
  let constants: Record<string, number> = createStockhamConstants(
    variant,
    inPlace,
  );
  if (variant.kind === 'inPlaceRadix4') {
    shader = isPowerOfEight
      ? transformInPlaceRadix8Shader
      : transformInPlaceRadix4Shader;
    constants = createInPlaceRadix4Constants(variant, inPlace);
  } else if (variant.kind === 'inPlaceMixed') {
    shader = transformInPlaceMixedShader;
    constants = createInPlaceMixedConstants(variant, inPlace);
  }
  const module = device.createShaderModule({
    label: 'packed-stockham-r2c-transform-shader',
    code: shader,
  });
  return {
    kind: variant.kind,
    transform: device.createComputePipeline({
      label: 'packed-stockham-r2c-transform-pipeline',
      layout: 'auto',
      compute: {
        module,
        entryPoint: 'main',
        constants,
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
  variant: Extract<PackedStockhamR2cVariant, { kind: 'multiPass' }>,
  inPlace: boolean,
): MultiPassPipeline => {
  const stageModule = device.createShaderModule({
    label: 'packed-stockham-r2c-multipass-stage-shader',
    code: multiPassStageShader,
  });
  const pairModule = device.createShaderModule({
    label: 'packed-stockham-r2c-multipass-pair-stage-shader',
    code: multiPassPairStageShader,
  });

  return {
    kind: 'multiPass',
    stages: variant.kernels.map((kernel) =>
      device.createComputePipeline({
        label: 'packed-stockham-r2c-multipass-stage-pipeline',
        layout: 'auto',
        compute: {
          module: kernel.kind === 'pair' ? pairModule : stageModule,
          entryPoint: 'main',
          constants: createMultiPassKernelConstants(variant, kernel, inPlace),
        },
      }),
    ),
  };
};

export type Pipeline = SinglePassPipeline | MultiPassPipeline;

export const createPipeline = (
  device: GPUDevice,
  variant: PackedStockhamR2cVariant,
  inPlace: boolean,
): Pipeline => {
  if (variant.kind === 'multiPass') {
    return createMultiPassPipeline(device, variant, inPlace);
  }
  return createSinglePassPipeline(device, variant, inPlace);
};
