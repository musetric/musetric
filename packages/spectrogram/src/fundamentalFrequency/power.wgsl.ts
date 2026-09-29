import { pitchParamsStruct } from './paramsStruct.wgsl.js';

export const powerShader = `
${pitchParamsStruct}

@group(0) @binding(0) var<storage, read_write> signal: array<f32>;
@group(0) @binding(1) var<uniform> params: PitchParams;

@compute @workgroup_size(64)
fn square(@builtin(global_invocation_id) gid: vec3<u32>) {
  let bin = gid.x;
  let slotIndex = gid.y;
  if (bin > params.halfSize || slotIndex >= params.slotCount) {
    return;
  }
  let offset = slotIndex * (params.fftSize + 2u) + 2u * bin;
  let value = vec2<f32>(signal[offset], signal[offset + 1u]);
  signal[offset] = dot(value, value);
  signal[offset + 1u] = 0.0;
}
`;
