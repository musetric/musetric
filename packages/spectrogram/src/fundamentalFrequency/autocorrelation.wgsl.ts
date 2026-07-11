import { fundamentalFrequencyParamsStruct } from './paramsStruct.wgsl.js';

export const autocorrelationShader = `
${fundamentalFrequencyParamsStruct}

@group(0) @binding(0) var<storage, read> magnitude: array<f32>;
@group(0) @binding(1) var<storage, read_write> periodicity: array<f32>;
@group(0) @binding(2) var<uniform> params: FundamentalFrequencyParams;

const workgroupWidth = 64u;
const tau = 6.28318530717958647692;

var<workgroup> workgroupCorr: array<f32, 64>;
var<workgroup> workgroupEnergy: array<f32, 64>;

@compute @workgroup_size(64)
fn autocorr(
  @builtin(workgroup_id) workgroupId: vec3<u32>,
  @builtin(local_invocation_id) localId: vec3<u32>,
) {
  let lagIndex = workgroupId.x;
  let localWindowIndex = workgroupId.y;
  let threadIndex = localId.x;
  if (
    lagIndex >= params.lagCount ||
    localWindowIndex >= params.columnCount ||
    params.lagCount == 0u
  ) {
    return;
  }

  let windowIndex = (params.slotOffset + localWindowIndex) % params.windowCount;
  let magnitudeBase = windowIndex * params.halfSize;
  let lag = params.minimumLag + f32(lagIndex) * params.lagStep;
  let stride = max(params.autocorrBinStride, 1u);
  let maxBin = min(params.autocorrMaxBin, params.halfSize - 1u);

  var corr = 0.0;
  var energy = 0.0;
  for (
    var bin = 1u + threadIndex * stride;
    bin <= maxBin;
    bin += workgroupWidth * stride
  ) {
    let power = max(magnitude[magnitudeBase + bin], 0.0);
    let angle = tau * f32(bin) * lag / f32(params.windowSize);
    corr += power * cos(angle);
    energy += power;
  }

  workgroupCorr[threadIndex] = corr;
  workgroupEnergy[threadIndex] = energy;
  workgroupBarrier();

  if (threadIndex != 0u) {
    return;
  }

  var totalCorr = 0.0;
  var totalEnergy = 0.0;
  for (var index = 0u; index < workgroupWidth; index += 1u) {
    totalCorr += workgroupCorr[index];
    totalEnergy += workgroupEnergy[index];
  }

  var value = 0.0;
  if (totalEnergy > 0.0) {
    let normalized = max(totalCorr / totalEnergy, 0.0);
    value = clamp(params.periodicityGain * normalized, 0.0, 1.0);
  }
  periodicity[windowIndex * params.lagCount + lagIndex] = value;
}
`;
