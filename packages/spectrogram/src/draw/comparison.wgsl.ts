import { centsDistanceWgsl } from '../common/centsDistance.wgsl.js';
import { harmonicLevelWgsl } from './harmonicLevel.wgsl.js';
import { drawParamsStruct } from './params.wgsl.js';

export const comparisonShader = `
${drawParamsStruct}

@group(0) @binding(0) var<uniform> drawParams : DrawParams;
@group(0) @binding(1) var spectrogramTextures : texture_2d_array<f32>;
@group(0) @binding(2) var<storage, read> referenceLine : array<f32>;
@group(0) @binding(3) var<storage, read> targetLine : array<f32>;
@group(0) @binding(4) var<storage, read_write> harmonicDifferences : array<vec2f>;

${centsDistanceWgsl}

${harmonicLevelWgsl}

fn relativeDecibels(level: f32, peak: f32) -> f32 {
  return max(
    (level - peak) * drawParams.comparisonLevels.y,
    -drawParams.comparisonLevels.x,
  );
}

fn harmonicDifference(
  harmonic: f32,
  leadFundamental: f32,
  takeFundamental: f32,
  leadSlot: u32,
  takeSlot: u32,
  leadPeak: f32,
  takePeak: f32,
  height: u32,
) -> vec2f {
  let takeFrequency = harmonic * takeFundamental;
  let minFrequency = exp(drawParams.frequencyMap.x);
  let maxFrequency = exp(drawParams.frequencyMap.x + drawParams.frequencyMap.y);
  if (takeFrequency < minFrequency || takeFrequency > maxFrequency) {
    return vec2f(0.0);
  }
  let take = relativeDecibels(
    harmonicLevel(takeSlot, 1u, takeFrequency, height),
    takePeak,
  );
  let lead = relativeDecibels(
    harmonicLevel(leadSlot, 0u, harmonic * leadFundamental, height),
    leadPeak,
  );
  let floor = -drawParams.comparisonLevels.x;
  if (take <= floor && lead <= floor) {
    return vec2f(0.0);
  }
  let fullDifference = drawParams.comparisonTuning.w;
  return vec2f(clamp(take - lead, -fullDifference, fullDifference), 1.0);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let dimensions = textureDimensions(spectrogramTextures);
  let width = dimensions.x;
  let x = gid.x;
  if (x >= width) {
    return;
  }
  let stride = u32(drawParams.comparisonLevels.z);
  let leadSlot = (drawParams.ringSlots.x + x) % width;
  let takeSlot = (drawParams.ringSlots.y + x) % width;
  let leadFundamental = referenceLine[(drawParams.ringSlots.z + x) % width];
  let takeFundamental = targetLine[(drawParams.ringSlots.w + x) % width];
  let comparable =
    leadFundamental > 0.0 &&
    takeFundamental > 0.0 &&
    centsDistance(takeFundamental, leadFundamental) <=
      drawParams.comparisonTuning.y;
  var leadPeak = 0.0;
  var takePeak = 0.0;
  if (comparable) {
    leadPeak = peakHarmonicLevel(leadFundamental, leadSlot, 0u, dimensions.y);
    takePeak = peakHarmonicLevel(takeFundamental, takeSlot, 1u, dimensions.y);
  }
  for (var index = 0u; index < stride; index += 1u) {
    var difference = vec2f(0.0);
    if (comparable) {
      difference = harmonicDifference(
        f32(index + 1u),
        leadFundamental,
        takeFundamental,
        leadSlot,
        takeSlot,
        leadPeak,
        takePeak,
        dimensions.y,
      );
    }
    harmonicDifferences[x * stride + index] = difference;
  }
}
`;
