import { type PackedStockhamR2cVariant } from './support.js';
import { transformInPlaceRadix4Shader } from './transformInPlaceRadix4Shader.js';
import { transformShader } from './transformShader.js';

const createConstants = (variant: PackedStockhamR2cVariant) => ({
  packedWindowSize: variant.packedWindowSize,
  log2PackedWindowSize: variant.log2PackedWindowSize,
});

export const createPipeline = (
  device: GPUDevice,
  variant: PackedStockhamR2cVariant,
): GPUComputePipeline => {
  const shader =
    variant.kind === 'inPlaceRadix4'
      ? transformInPlaceRadix4Shader
      : transformShader;
  const module = device.createShaderModule({
    label: 'packed-stockham-r2c-transform-shader',
    code: shader,
  });
  return device.createComputePipeline({
    label: 'packed-stockham-r2c-transform-pipeline',
    layout: 'auto',
    compute: {
      module,
      entryPoint: 'main',
      constants: createConstants(variant),
    },
  });
};
