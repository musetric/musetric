import { multiPassPackShader } from './multiPassPackShader.js';
import { multiPassStageShader } from './multiPassStageShader.js';
import {
  type PackedStockhamR2cStage,
  type PackedStockhamR2cVariant,
} from './support.js';
import { transformInPlaceMixedShader } from './transformInPlaceMixedShader.js';
import { transformInPlaceRadix4Shader } from './transformInPlaceRadix4Shader.js';
import { transformInPlaceRadix8Shader } from './transformInPlaceRadix8Shader.js';
import { transformShader } from './transformShader.js';

export type SinglePassPipeline = {
  kind: 'stockham' | 'inPlaceRadix4' | 'inPlaceMixed';
  transform: GPUComputePipeline;
};

export type MultiPassPipeline = {
  kind: 'multiPass';
  stages: GPUComputePipeline[];
  pack: GPUComputePipeline;
};

export type Pipeline = SinglePassPipeline | MultiPassPipeline;

const selectStockhamThreadCount = (packedWindowSize: number): number => {
  if (packedWindowSize <= 768) {
    return 64;
  }
  if (packedWindowSize <= 1024) {
    return 128;
  }
  return 256;
};

const isPowerOfTwo = (value: number): boolean => (value & (value - 1)) === 0;

// For power-of-two sizes prefer radix-8 stages to reduce stage/barrier count
// (e.g. 2^11 -> 8,8,8,4 = 4 stages instead of 4,4,4,4,4,2 = 6 stages).
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

const createStockhamConstants = (variant: PackedStockhamR2cVariant) => ({
  packedWindowSize: variant.packedWindowSize,
  threadCount: selectStockhamThreadCount(variant.packedWindowSize),
  radix8StageCount: 0,
  ...variant.radixStageCounts,
  ...(isPowerOfTwo(variant.packedWindowSize)
    ? createRadix8StageCounts(variant.packedWindowSize)
    : {}),
});

const createInPlaceRadix4Constants = (variant: PackedStockhamR2cVariant) => ({
  packedWindowSize: variant.packedWindowSize,
  log2PackedWindowSize: variant.log2PackedWindowSize,
  threadCount: selectStockhamThreadCount(variant.packedWindowSize),
});

const createInPlaceMixedConstants = (
  variant: Extract<PackedStockhamR2cVariant, { kind: 'inPlaceMixed' }>,
) => {
  const counts = variant.inPlaceStageCounts;
  const stageCount =
    counts.radix8StageCount +
    counts.radix4StageCount +
    counts.radix2StageCount +
    counts.radix3StageCount +
    counts.radix5StageCount;
  // Fewer-stage transforms favour more, smaller workgroups; deeper ones favour
  // the wider 256-thread groups for the high-butterfly-count radix-2/4 stages.
  const threadCount = stageCount <= 4 ? 128 : 256;
  return {
    packedWindowSize: variant.packedWindowSize,
    threadCount,
    ...counts,
  };
};

const createMultiPassStageConstants = (
  variant: Extract<PackedStockhamR2cVariant, { kind: 'multiPass' }>,
  stage: PackedStockhamR2cStage,
) => ({
  packedWindowSize: variant.packedWindowSize,
  factor: stage.factor,
  stageStride: stage.stageStride,
  readFromInput: stage.readFromInput ? 1 : 0,
  readBufferIndex: stage.readBufferIndex,
  writeBufferIndex: stage.writeBufferIndex,
});

const createMultiPassPackConstants = (
  variant: Extract<PackedStockhamR2cVariant, { kind: 'multiPass' }>,
) => ({
  packedWindowSize: variant.packedWindowSize,
  finalReadBufferIndex: variant.finalReadBufferIndex,
});

const createSinglePassPipeline = (
  device: GPUDevice,
  variant: Exclude<PackedStockhamR2cVariant, { kind: 'multiPass' }>,
): SinglePassPipeline => {
  const isPowerOfEight =
    isPowerOfTwo(variant.packedWindowSize) &&
    variant.log2PackedWindowSize % 3 === 0;
  let shader = transformShader;
  let constants: Record<string, number> = createStockhamConstants(variant);
  if (variant.kind === 'inPlaceRadix4') {
    shader = isPowerOfEight
      ? transformInPlaceRadix8Shader
      : transformInPlaceRadix4Shader;
    constants = createInPlaceRadix4Constants(variant);
  } else if (variant.kind === 'inPlaceMixed') {
    shader = transformInPlaceMixedShader;
    constants = createInPlaceMixedConstants(variant);
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

const createMultiPassPipeline = (
  device: GPUDevice,
  variant: Extract<PackedStockhamR2cVariant, { kind: 'multiPass' }>,
): MultiPassPipeline => {
  const stageModule = device.createShaderModule({
    label: 'packed-stockham-r2c-multipass-stage-shader',
    code: multiPassStageShader,
  });
  const packModule = device.createShaderModule({
    label: 'packed-stockham-r2c-multipass-pack-shader',
    code: multiPassPackShader,
  });

  return {
    kind: 'multiPass',
    stages: variant.stages.map((stage) =>
      device.createComputePipeline({
        label: 'packed-stockham-r2c-multipass-stage-pipeline',
        layout: 'auto',
        compute: {
          module: stageModule,
          entryPoint: 'main',
          constants: createMultiPassStageConstants(variant, stage),
        },
      }),
    ),
    pack: device.createComputePipeline({
      label: 'packed-stockham-r2c-multipass-pack-pipeline',
      layout: 'auto',
      compute: {
        module: packModule,
        entryPoint: 'main',
        constants: createMultiPassPackConstants(variant),
      },
    }),
  };
};

export function createPipeline(
  device: GPUDevice,
  variant: Extract<PackedStockhamR2cVariant, { kind: 'multiPass' }>,
): MultiPassPipeline;
export function createPipeline(
  device: GPUDevice,
  variant: Exclude<PackedStockhamR2cVariant, { kind: 'multiPass' }>,
): SinglePassPipeline;
export function createPipeline(
  device: GPUDevice,
  variant: PackedStockhamR2cVariant,
): Pipeline {
  if (variant.kind === 'multiPass') {
    return createMultiPassPipeline(device, variant);
  }
  return createSinglePassPipeline(device, variant);
}
