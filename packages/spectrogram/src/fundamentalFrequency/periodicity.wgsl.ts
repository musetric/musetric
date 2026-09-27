import { pitchParamsStruct } from './paramsStruct.wgsl.js';
import { pitchSlotStruct } from './slots.wgsl.js';

export const periodicityShader = `
${pitchParamsStruct}
${pitchSlotStruct}

@group(0) @binding(0) var<storage, read> span: array<f32>;
@group(0) @binding(1) var<storage, read> slots: array<PitchSlot>;
@group(0) @binding(2) var<storage, read_write> periodicity: array<f32>;
@group(0) @binding(3) var<uniform> params: PitchParams;

const workgroupWidth = 256u;
const maxSegment = 1536u;

var<workgroup> segment: array<f32, 1536>;
var<workgroup> energy: array<f32, 1537>;
var<workgroup> chunkTotals: array<f32, 256>;

@compute @workgroup_size(256)
fn correlate(
  @builtin(workgroup_id) workgroupId: vec3<u32>,
  @builtin(local_invocation_id) localId: vec3<u32>,
) {
  let slotIndex = workgroupId.x;
  let threadIndex = localId.x;
  if (slotIndex >= params.slotCount) {
    return;
  }
  let maxLag = params.minimumLag + params.lagCount - 1u;
  let segmentLength = min(params.periodicityWindow + maxLag + 1u, maxSegment);
  let start = slots[slotIndex].spanOffset + params.support - segmentLength / 2u;

  for (var index = threadIndex; index < segmentLength; index += workgroupWidth) {
    segment[index] = span[start + index];
  }
  workgroupBarrier();

  let chunk = (segmentLength + workgroupWidth - 1u) / workgroupWidth;
  let chunkStart = min(threadIndex * chunk, segmentLength);
  let chunkEnd = min(chunkStart + chunk, segmentLength);
  var running = 0.0;
  for (var index = chunkStart; index < chunkEnd; index += 1u) {
    running += segment[index] * segment[index];
    energy[index + 1u] = running;
  }
  chunkTotals[threadIndex] = running;
  workgroupBarrier();

  if (threadIndex == 0u) {
    var total = 0.0;
    for (var index = 0u; index < workgroupWidth; index += 1u) {
      let chunkTotal = chunkTotals[index];
      chunkTotals[index] = total;
      total += chunkTotal;
    }
    energy[0] = 0.0;
  }
  workgroupBarrier();

  let offset = chunkTotals[threadIndex];
  for (var index = chunkStart; index < chunkEnd; index += 1u) {
    energy[index + 1u] += offset;
  }
  workgroupBarrier();

  let window = params.periodicityWindow;
  let base = slotIndex * params.lagCount;
  for (
    var lagIndex = threadIndex;
    lagIndex < params.lagCount;
    lagIndex += workgroupWidth
  ) {
    let lag = params.minimumLag + lagIndex;
    var value = 0.0;
    if (window + lag < segmentLength) {
      let first = (segmentLength - window - lag) / 2u;
      let second = first + lag;
      var sum = 0.0;
      for (var index = 0u; index < window; index += 1u) {
        sum += segment[first + index] * segment[second + index];
      }
      let firstEnergy = energy[first + window] - energy[first];
      let secondEnergy = energy[second + window] - energy[second];
      let denominator = sqrt(max(firstEnergy * secondEnergy, 0.0));
      if (denominator > 1.0e-12) {
        value = sum / denominator;
      }
    }
    periodicity[base + lagIndex] = value;
  }
}
`;
