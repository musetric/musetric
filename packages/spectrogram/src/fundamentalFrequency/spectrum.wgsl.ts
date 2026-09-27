import { pitchParamsStruct } from './paramsStruct.wgsl.js';
import { pitchSlotStruct } from './slots.wgsl.js';

export const spectrumShader = `
${pitchParamsStruct}
${pitchSlotStruct}

@group(0) @binding(0) var<storage, read> signal: array<f32>;
@group(0) @binding(1) var<storage, read> slots: array<PitchSlot>;
@group(0) @binding(2) var<storage, read_write> whitened: array<f32>;
@group(0) @binding(3) var<storage, read_write> frequencies: array<f32>;
@group(0) @binding(4) var<storage, read_write> levels: array<f32>;
@group(0) @binding(5) var<uniform> params: PitchParams;

const workgroupWidth = 256u;
const maxSpectrumBins = 2048u;
const tau = 6.28318530717958647692;

var<workgroup> cumulative: array<f32, 2049>;
var<workgroup> chunkTotals: array<f32, 256>;
var<workgroup> powerTotals: array<f32, 256>;

fn magnitudeAt(slotIndex: u32, bin: u32) -> f32 {
  let offset = slotIndex * (params.fftSize + 2u) + 2u * bin;
  return length(vec2<f32>(signal[offset], signal[offset + 1u]));
}

fn wrapPhase(value: f32) -> f32 {
  return value - tau * floor(value / tau + 0.5);
}

@compute @workgroup_size(256)
fn spectrum(
  @builtin(workgroup_id) workgroupId: vec3<u32>,
  @builtin(local_invocation_id) localId: vec3<u32>,
) {
  let slotIndex = workgroupId.x;
  let threadIndex = localId.x;
  if (slotIndex >= params.slotCount) {
    return;
  }
  let predecessor = slots[slotIndex].predecessor;
  let bins = min(params.spectrumBins, maxSpectrumBins);
  let chunk = (bins + workgroupWidth - 1u) / workgroupWidth;
  let chunkStart = min(threadIndex * chunk, bins);
  let chunkEnd = min(chunkStart + chunk, bins);

  var running = 0.0;
  var power = 0.0;
  for (var bin = chunkStart; bin < chunkEnd; bin += 1u) {
    let value = magnitudeAt(slotIndex, bin);
    running += value;
    power += value * value;
    cumulative[bin + 1u] = running;
  }
  chunkTotals[threadIndex] = running;
  powerTotals[threadIndex] = power;
  workgroupBarrier();

  if (threadIndex == 0u) {
    var total = 0.0;
    var totalPower = 0.0;
    for (var index = 0u; index < workgroupWidth; index += 1u) {
      let chunkTotal = chunkTotals[index];
      chunkTotals[index] = total;
      total += chunkTotal;
      totalPower += powerTotals[index];
    }
    cumulative[0] = 0.0;
    levels[slotIndex] = 3.01029996 * log2(totalPower + 1.0e-30) -
      params.levelOffsetDb;
  }
  workgroupBarrier();

  let offset = chunkTotals[threadIndex];
  for (var bin = chunkStart; bin < chunkEnd; bin += 1u) {
    cumulative[bin + 1u] += offset;
  }
  workgroupBarrier();

  let ratio = exp2(params.envelopeHalfOctaves) - 1.0;
  let whitenedBase = slotIndex * params.spectrumBins;
  for (var bin = chunkStart; bin < chunkEnd; bin += 1u) {
    let center = f32(bin);
    let halfWidth = max(center * ratio, params.envelopeMinHalfBins);
    let low = u32(max(center - halfWidth, 0.0));
    let high = min(u32(center + halfWidth), bins - 1u);
    let mean =
      (cumulative[high + 1u] - cumulative[low]) / f32(high - low + 1u);
    var value = 0.0;
    if (mean > 1.0e-20) {
      value = magnitudeAt(slotIndex, bin) / mean;
    }
    whitened[whitenedBase + bin] = value;
  }

  let frequencyBase = slotIndex * params.phaseBins;
  let hop = f32(params.hop);
  let fftSize = f32(params.fftSize);
  for (var bin = threadIndex; bin < params.phaseBins; bin += workgroupWidth) {
    var frequency = -1.0;
    if (predecessor >= 0) {
      let current = slotIndex * (params.fftSize + 2u) + 2u * bin;
      let previous = u32(predecessor) * (params.fftSize + 2u) + 2u * bin;
      let a = vec2<f32>(signal[current], signal[current + 1u]);
      let b = vec2<f32>(signal[previous], signal[previous + 1u]);
      let product = vec2<f32>(a.x * b.x + a.y * b.y, a.y * b.x - a.x * b.y);
      let binOmega = tau * f32(bin) / fftSize;
      let deviation = wrapPhase(atan2(product.y, product.x) - binOmega * hop);
      frequency = (binOmega + deviation / hop) * params.sampleRate / tau;
    }
    frequencies[frequencyBase + bin] = frequency;
  }
}
`;
