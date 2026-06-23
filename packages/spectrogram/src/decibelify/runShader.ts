export const runShader = `
struct DecibelifyParams {
  halfSize: u32,
  windowCount: u32,
  decibelFactor: f32,
  gain: f32,
  gateFloorDb: f32,
  gateRangeDb: f32,
};

@group(0) @binding(0) var<storage, read> magnitude: array<f32>;
@group(0) @binding(1) var<uniform> params: DecibelifyParams;
@group(0) @binding(2) var<storage, read_write> columnEnergy: array<f32>;
@group(0) @binding(3) var<storage, read_write> signal: array<f32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let halfSize = params.halfSize;
  let windowCount = params.windowCount;
  let decibelFactor = params.decibelFactor;
  let gain = params.gain;
  
  let sampleIndex = gid.x;
  let windowIndex = gid.y;
  if (sampleIndex >= halfSize || windowIndex >= windowCount) {
    return;
  }
  let windowOffset = halfSize * windowIndex + sampleIndex;
  let referenceMagnitude = sqrt(f32(halfSize));
  let epsilon = 1e-12;
  let normalizedMagnitude = magnitude[windowOffset] * gain / referenceMagnitude + epsilon;
  let normalizedEnergy = columnEnergy[windowIndex] * gain / referenceMagnitude + epsilon;
  let energyDb = log(normalizedEnergy) * 8.685889638;
  let gate = clamp((energyDb - params.gateFloorDb) / params.gateRangeDb, 0.0, 1.0);
  var decibel = log(normalizedMagnitude) * decibelFactor + 1.0;
  if (decibel < 0.0) {
    decibel = 0.0;
  }
  signal[windowOffset] = decibel * gate;
}
`;
