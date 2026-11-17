import { drawParamsStruct } from './params.wgsl.js';

export const columnsShader = `
${drawParamsStruct}

@group(0) @binding(0) var<uniform> drawParams : DrawParams;
@group(0) @binding(1) var<storage, read> referenceLine : array<f32>;
@group(0) @binding(2) var<storage, read> targetLine : array<f32>;
@group(0) @binding(3) var<storage, read_write> lineColumns : array<vec4f>;

fn logSpan(center: f32, previous: f32, next: f32) -> vec2f {
  if (center <= 0.0) {
    return vec2f(1e30, -1e30);
  }
  let centerLog = log(center);
  var low = centerLog;
  var high = centerLog;
  if (previous > 0.0) {
    let previousLog = log(previous);
    low = min(low, previousLog);
    high = max(high, previousLog);
  }
  if (next > 0.0) {
    let nextLog = log(next);
    low = min(low, nextLog);
    high = max(high, nextLog);
  }
  return vec2f(low, high);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let width = arrayLength(&lineColumns);
  let x = id.x;
  if (x >= width) {
    return;
  }
  let referenceBase = drawParams.ringSlots.z;
  let targetBase = drawParams.ringSlots.w;
  var referencePrevious = 0.0;
  var targetPrevious = 0.0;
  if (x > 0u) {
    referencePrevious = referenceLine[(referenceBase + x - 1u) % width];
    targetPrevious = targetLine[(targetBase + x - 1u) % width];
  }
  var referenceNext = 0.0;
  var targetNext = 0.0;
  if (x + 1u < width) {
    referenceNext = referenceLine[(referenceBase + x + 1u) % width];
    targetNext = targetLine[(targetBase + x + 1u) % width];
  }
  lineColumns[x] = vec4f(
    logSpan(referenceLine[(referenceBase + x) % width], referencePrevious, referenceNext),
    logSpan(targetLine[(targetBase + x) % width], targetPrevious, targetNext),
  );
}
`;
