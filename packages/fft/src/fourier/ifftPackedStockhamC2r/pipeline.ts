import { type PackedStockhamC2rVariant } from './support.js';
import { transformShader } from './transformShader.js';

const createConstants = (variant: PackedStockhamC2rVariant) => ({
  packedWindowSize: variant.packedWindowSize,
  positiveWindowSize: variant.positiveWindowSize,
  log2PackedWindowSize: variant.log2PackedWindowSize,
});

export const createPipeline = (
  device: GPUDevice,
  variant: PackedStockhamC2rVariant,
): GPUComputePipeline => {
  const module = device.createShaderModule({
    label: 'packed-stockham-c2r-transform-shader',
    code: transformShader,
  });
  return device.createComputePipeline({
    label: 'packed-stockham-c2r-transform-pipeline',
    layout: 'auto',
    compute: {
      module,
      entryPoint: 'main',
      constants: createConstants(variant),
    },
  });
};
