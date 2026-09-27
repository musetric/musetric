import { pitchParamsStruct } from './paramsStruct.wgsl.js';
import { pitchSlotStruct } from './slots.wgsl.js';

export const sliceShader = `
${pitchParamsStruct}
${pitchSlotStruct}

@group(0) @binding(0) var<storage, read> span: array<f32>;
@group(0) @binding(1) var<storage, read> slots: array<PitchSlot>;
@group(0) @binding(2) var<storage, read> weights: array<f32>;
@group(0) @binding(3) var<storage, read_write> signal: array<f32>;
@group(0) @binding(4) var<uniform> params: PitchParams;

@compute @workgroup_size(64)
fn slice(@builtin(global_invocation_id) gid: vec3<u32>) {
  let sampleIndex = gid.x;
  let slotIndex = gid.y;
  if (sampleIndex >= params.fftSize || slotIndex >= params.slotCount) {
    return;
  }
  var value = 0.0;
  if (sampleIndex < params.windowSize) {
    let spanIndex = slots[slotIndex].spanOffset + params.support -
      params.windowSize / 2u + sampleIndex;
    value = span[spanIndex] * weights[sampleIndex];
  }
  signal[slotIndex * (params.fftSize + 2u) + sampleIndex] = value;
}
`;
