import { pitchParamsStruct } from './paramsStruct.wgsl.js';
import { pitchSlotStruct } from './slots.wgsl.js';

export const pitchSliceSamplesPerThread = 4;

export const sliceShader = `
const samplesPerThread = ${pitchSliceSamplesPerThread}u;

${pitchParamsStruct}
${pitchSlotStruct}

@group(0) @binding(0) var<storage, read> span: array<f32>;
@group(0) @binding(1) var<storage, read> slots: array<PitchSlot>;
@group(0) @binding(2) var<storage, read> weights: array<f32>;
@group(0) @binding(3) var<storage, read_write> signal: array<f32>;
@group(0) @binding(4) var<uniform> params: PitchParams;

@compute @workgroup_size(64)
fn slice(
  @builtin(workgroup_id) groupId: vec3<u32>,
  @builtin(local_invocation_id) localId: vec3<u32>,
) {
  let firstSample = groupId.x * 64u * samplesPerThread + localId.x;
  let slotIndex = groupId.y;
  if (slotIndex >= params.slotCount) {
    return;
  }
  let spanStart = slots[slotIndex].spanOffset + params.support -
    params.windowSize / 2u + params.windowOffset;
  let signalStart = slotIndex * (params.fftSize + 2u);
  for (var repeat = 0u; repeat < samplesPerThread; repeat += 1u) {
    let sampleIndex = firstSample + 64u * repeat;
    if (sampleIndex >= params.fftSize) {
      break;
    }
    var value = 0.0;
    if (sampleIndex < params.windowSize) {
      value = span[spanStart + sampleIndex] * weights[sampleIndex];
    }
    signal[signalStart + sampleIndex] = value;
  }
}
`;
