import { pitchParamsStruct } from './paramsStruct.wgsl.js';
import { pitchDecodedStruct } from './slots.wgsl.js';

export const smoothShader = `
${pitchParamsStruct}
${pitchDecodedStruct}

@group(0) @binding(0) var<storage, read_write> decoded: array<PitchDecoded>;
@group(0) @binding(1) var<uniform> params: PitchParams;

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
  let raw = decoded[slot].raw;
  if (raw <= 0.0) {
    decoded[slot].frequency = raw;
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
    if (neighbor < 0 || neighbor >= params.trackFrames) {
      continue;
    }
    let index = u32(neighbor) % params.ringFrames;
    if (decoded[index].frame != neighbor) {
      continue;
    }
    let value = decoded[index].raw;
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
