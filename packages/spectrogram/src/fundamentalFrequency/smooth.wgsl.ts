import { pitchParamsStruct } from './paramsStruct.wgsl.js';
import { pitchDecodedStruct } from './slots.wgsl.js';

export const smoothShader = `
${pitchParamsStruct}
${pitchDecodedStruct}

@group(0) @binding(0) var<storage, read_write> decoded: array<PitchDecoded>;
@group(0) @binding(1) var<storage, read> folded: array<f32>;
@group(0) @binding(2) var<uniform> params: PitchParams;

fn foldedAt(frame: i32) -> f32 {
  if (frame < 0 || frame >= params.trackFrames) {
    return 0.0;
  }
  return folded[u32(frame) % params.ringFrames];
}

fn filledRaw(frame: i32) -> f32 {
  let value = foldedAt(frame);
  if (value > 0.0 || params.fillGapFrames == 0u) {
    return value;
  }
  let gap = i32(params.fillGapFrames);
  var before = frame - 1;
  while (frame - before <= gap && foldedAt(before) <= 0.0) {
    before -= 1;
  }
  var after = frame + 1;
  while (after - frame <= gap && foldedAt(after) <= 0.0) {
    after += 1;
  }
  let steps = after - before;
  let first = foldedAt(before);
  let last = foldedAt(after);
  if (steps - 1 > gap || first <= 0.0 || last <= 0.0) {
    return 0.0;
  }
  let limit = min(
    params.fillBaseCents + params.fillSlopeCents * f32(steps),
    params.fillCapCents,
  );
  if (abs(log2(first) - log2(last)) * 1200.0 > limit) {
    return 0.0;
  }
  return exp2(mix(log2(first), log2(last), f32(frame - before) / f32(steps)));
}

@compute @workgroup_size(64)
fn smoothPitch(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= params.smoothCount) {
    return;
  }
  let frame = params.smoothFirst + i32(gid.x);
  let slot = u32(frame) % params.ringFrames;
  if (decoded[slot].frame != frame) {
    return;
  }
  let raw = filledRaw(frame);
  if (raw <= 0.0) {
    decoded[slot].frequency = 0.0;
    return;
  }
  let center = log2(raw);
  let limit = params.smoothLimitCents / 1200.0;
  var sum = 0.0;
  var count = 0.0;
  for (
    var neighbor = frame - i32(params.smoothBackFrames);
    neighbor <= frame + i32(params.smoothAheadFrames);
    neighbor += 1
  ) {
    let value = filledRaw(neighbor);
    if (value <= 0.0) {
      continue;
    }
    let octaves = log2(value);
    if (abs(octaves - center) <= limit) {
      sum += octaves;
      count += 1.0;
    }
  }
  decoded[slot].frequency = exp2(sum / count);
}
`;
