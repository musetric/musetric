export const runShader = `
struct DecibelifyParams {
  halfSize: u32,
  windowCount: u32,
  decibelFactor: f32,
  gain: f32,
  gainOverReferenceMagnitude: f32,
  gateFloorDb: f32,
  gateRangeDb: f32,
  slotOffset: u32,
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
  let gainOverReferenceMagnitude = params.gainOverReferenceMagnitude;

  let sampleIndex = gid.x;
  let localWindowIndex = gid.y;
  let windowIndex = (params.slotOffset + localWindowIndex) % windowCount;
  if (sampleIndex >= halfSize || localWindowIndex >= windowCount) {
    return;
  }
  let windowOffset = halfSize * windowIndex + sampleIndex;
  let epsilon = 1e-12;
  let gainOverRefMagSq = gainOverReferenceMagnitude * gainOverReferenceMagnitude;
  let halfDecibelFactor = decibelFactor * 0.5;
  let normalizedMagnitudeSq = magnitude[windowOffset] * gainOverRefMagSq + epsilon;
  let normalizedEnergy = columnEnergy[windowIndex] * gainOverReferenceMagnitude + epsilon;
  let energyDb = log(normalizedEnergy) * 8.685889638;
  let gate = clamp((energyDb - params.gateFloorDb) / params.gateRangeDb, 0.0, 1.0);
  var decibel = log(normalizedMagnitudeSq) * halfDecibelFactor + 1.0;
  if (decibel < 0.0) {
    decibel = 0.0;
  }
  signal[windowOffset] = decibel * gate;
}
`;
