import { pitchParamsStruct } from './paramsStruct.wgsl.js';
import { pitchDecodedStruct } from './slots.wgsl.js';

export const smoothShader = `
${pitchParamsStruct}
${pitchDecodedStruct}

@group(0) @binding(0) var<storage, read_write> decoded: array<PitchDecoded>;
@group(0) @binding(1) var<uniform> params: PitchParams;

fn rawAt(frame: i32) -> f32 {
  if (frame < 0 || frame >= params.trackFrames) {
    return 0.0;
  }
  let index = u32(frame) % params.ringFrames;
  if (decoded[index].frame != frame) {
    return 0.0;
  }
  return max(decoded[index].raw, 0.0);
}

fn centsOf(frequency: f32) -> f32 {
  return 1200.0 * log2(frequency);
}

fn joined(earlier: i32, later: i32) -> bool {
  let a = rawAt(earlier);
  let b = rawAt(later);
  return a > 0.0 && b > 0.0 &&
    abs(centsOf(a) - centsOf(b)) <= params.foldSplitCents;
}

fn anchored(first: i32, direction: i32) -> bool {
  for (var step = 1; step < i32(params.foldAnchorFrames); step += 1) {
    if (!joined(first + direction * (step - 1), first + direction * step)) {
      return false;
    }
  }
  return true;
}

fn neighborAbove(edge: i32, direction: i32) -> bool {
  let edgeCents = centsOf(rawAt(edge));
  for (var step = 1; step <= i32(params.foldGapFrames) + 1; step += 1) {
    let frame = edge + direction * step;
    let value = rawAt(frame);
    if (value <= 0.0) {
      continue;
    }
    return abs(centsOf(value) - edgeCents - 1200.0) <= params.foldToleranceCents &&
      anchored(frame, direction);
  }
  return false;
}

fn foldedRaw(frame: i32) -> f32 {
  let raw = rawAt(frame);
  if (raw <= 0.0 || params.foldMaxFrames == 0u) {
    return raw;
  }
  let reach = i32(params.foldMaxFrames);
  var start = frame;
  while (frame - start < reach && joined(start - 1, start)) {
    start -= 1;
  }
  var end = frame;
  while (end - start < reach && joined(end, end + 1)) {
    end += 1;
  }
  if (end - start + 1 > reach || joined(start - 1, start) || joined(end, end + 1)) {
    return raw;
  }
  if (neighborAbove(start, -1) || neighborAbove(end, 1)) {
    return 2.0 * raw;
  }
  return raw;
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
  let raw = foldedRaw(frame);
  if (raw <= 0.0) {
    decoded[slot].frequency = decoded[slot].raw;
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
    let value = foldedRaw(neighbor);
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
