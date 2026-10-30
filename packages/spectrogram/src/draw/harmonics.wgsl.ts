import { harmonicLevelWgsl } from './harmonicLevel.wgsl.js';
import { drawParamsStruct } from './params.wgsl.js';

export const harmonicsShader = `
${drawParamsStruct}

@group(0) @binding(0) var<uniform> drawParams : DrawParams;
@group(0) @binding(1) var spectrogramTextures : texture_2d_array<f32>;
@group(0) @binding(2) var<storage, read> referenceLine : array<f32>;
@group(0) @binding(3) var<storage, read> targetLine : array<f32>;
@group(0) @binding(4) var<storage, read_write> dominantHarmonics : array<u32>;

${harmonicLevelWgsl}

fn dominantHarmonic(fundamental: f32, slot: u32, layer: u32, height: u32) -> u32 {
  let minFrequency = exp(drawParams.frequencyMap.x);
  var dominant = 0u;
  var bestLevel = 0.0;
  var secondLevel = 0.0;
  for (
    var harmonic = 1u;
    f32(harmonic) * fundamental <= drawParams.harmonicTuning.y;
    harmonic += 1u
  ) {
    let frequency = f32(harmonic) * fundamental;
    if (frequency < minFrequency) {
      continue;
    }
    let level = harmonicLevel(slot, layer, frequency, height);
    if (level > bestLevel) {
      secondLevel = bestLevel;
      bestLevel = level;
      dominant = harmonic;
    } else if (level > secondLevel) {
      secondLevel = level;
    }
  }
  if (bestLevel - secondLevel < drawParams.harmonicTuning.w) {
    return 0u;
  }
  return dominant;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let dimensions = textureDimensions(spectrogramTextures);
  let width = dimensions.x;
  let slot = gid.x;
  let layer = gid.y;
  if (slot >= width || layer >= 2u) {
    return;
  }
  let fundamental = select(referenceLine[slot], targetLine[slot], layer == 1u);
  var dominant = 0u;
  if (fundamental > 0.0) {
    dominant = dominantHarmonic(fundamental, slot, layer, dimensions.y);
  }
  dominantHarmonics[layer * width + slot] = dominant;
}
`;
