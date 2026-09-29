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
var<workgroup> energy: array<f32, 1664>;
var<workgroup> chunkTotals: array<f32, 256>;

fn normalized(first: u32, second: u32, window: u32, sum: f32) -> f32 {
  let firstEnergy = energy[first + window] - energy[first];
  let secondEnergy = energy[second + window] - energy[second];
  let denominator = sqrt(max(firstEnergy * secondEnergy, 0.0));
  if (denominator > 1.0e-12) {
    return sum / denominator;
  }
  return 0.0;
}

fn correlateOne(lag: u32, reach: u32, window: u32) -> f32 {
  if (lag >= reach) {
    return 0.0;
  }
  let first = (reach - lag) / 2u;
  let second = first + lag;
  var sum = 0.0;
  for (var index = 0u; index < window; index += 1u) {
    sum += segment[first + index] * segment[second + index];
  }
  return normalized(first, second, window, sum);
}

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
  let reach = segmentLength - window;
  let base = slotIndex * params.lagCount;
  let groupCount = 2u * ((params.lagCount + 7u) / 8u);
  for (var groupIndex = threadIndex; groupIndex < groupCount; groupIndex += workgroupWidth) {
    let lagIndex = (groupIndex / 2u) * 8u + groupIndex % 2u;
    let lag = params.minimumLag + lagIndex;
    if (lagIndex + 6u >= params.lagCount || lag + 6u >= reach) {
      for (var part = 0u; part < 4u; part += 1u) {
        let index = lagIndex + 2u * part;
        if (index < params.lagCount) {
          periodicity[base + index] =
            correlateOne(params.minimumLag + index, reach, window);
        }
      }
      continue;
    }
    let first = (reach - lag) / 2u;
    let second = first + lag;
    var x1 = segment[first - 1u];
    var x2 = segment[first - 2u];
    var x3 = segment[first - 3u];
    var y0 = segment[second];
    var y1 = segment[second + 1u];
    var y2 = segment[second + 2u];
    var sum0 = 0.0;
    var sum1 = 0.0;
    var sum2 = 0.0;
    var sum3 = 0.0;
    for (var index = 0u; index < window; index += 1u) {
      let x0 = segment[first + index];
      let y3 = segment[second + 3u + index];
      sum0 += x0 * y0;
      sum1 += x1 * y1;
      sum2 += x2 * y2;
      sum3 += x3 * y3;
      x3 = x2;
      x2 = x1;
      x1 = x0;
      y0 = y1;
      y1 = y2;
      y2 = y3;
    }
    periodicity[base + lagIndex] = normalized(first, second, window, sum0);
    periodicity[base + lagIndex + 2u] =
      normalized(first - 1u, second + 1u, window, sum1);
    periodicity[base + lagIndex + 4u] =
      normalized(first - 2u, second + 2u, window, sum2);
    periodicity[base + lagIndex + 6u] =
      normalized(first - 3u, second + 3u, window, sum3);
  }
}
`;
