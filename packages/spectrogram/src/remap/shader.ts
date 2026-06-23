export const shader = `
struct RemapParams {
  halfSize: u32,
  width: u32,
  height: u32,
  windowSize: u32,
  sampleRate: f32,
  logMinFrequency: f32,
  logFrequencyRange: f32,
  decibelFactor: f32,
  gain: f32,
  gateFloorDb: f32,
  gateRangeDb: f32,
};

@group(0) @binding(0) var<storage, read> rawMagnitude: array<f32>;
@group(0) @binding(1) var texture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params: RemapParams;
@group(0) @binding(3) var<storage, read> columnEnergy: array<f32>;

fn displayFrequencyTilt(frequency: f32) -> f32 {
  let anchorFrequency = 440.0;
  let slope = 0.14;
  return clamp(pow(frequency / anchorFrequency, slope), 0.72, 1.55);
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let halfSize = params.halfSize;
  let width = params.width;
  let height = params.height;
  let windowSize = params.windowSize;
  let sampleRate = params.sampleRate;
  let logMinFrequency = params.logMinFrequency;
  let logFrequencyRange = params.logFrequencyRange;
  let decibelFactor = params.decibelFactor;
  let gain = params.gain;
  
  let x = gid.x;
  let y = gid.y;
  if (x >= width || y >= height) {
    return;
  }
  let ratio = 1.0 - f32(y) / f32(height - 1u);
  let frequency = exp(logMinFrequency + logFrequencyRange * ratio);
  let rawIndex = (frequency / sampleRate) * f32(windowSize);
  let clampedIndex = clamp(rawIndex, 0.0, f32(halfSize - 1u));
  let lowerIndex = u32(floor(clampedIndex));
  let upperIndex = min(lowerIndex + 1u, halfSize - 1u);
  let blend = fract(clampedIndex);
  let offset = x * halfSize;
  let lowerMagnitude = rawMagnitude[offset + lowerIndex];
  let upperMagnitude = rawMagnitude[offset + upperIndex];
  let magnitude = mix(lowerMagnitude, upperMagnitude, blend);
  let referenceMagnitude = sqrt(f32(halfSize));
  let epsilon = 1e-12;
  let normalizedMagnitude = magnitude * gain / referenceMagnitude + epsilon;
  let normalizedEnergy = columnEnergy[x] * gain / referenceMagnitude + epsilon;
  let energyDb = log(normalizedEnergy) * 8.685889638;
  let gate = clamp(
    (energyDb - params.gateFloorDb) / params.gateRangeDb,
    0.0,
    1.0,
  );
  let decibel = max(log(normalizedMagnitude) * decibelFactor + 1.0, 0.0);
  let intensity = clamp(
    decibel * gate * displayFrequencyTilt(frequency),
    0.0,
    1.0,
  );
  textureStore(texture, vec2u(x, y), vec4f(intensity, 0.0, 0.0, 1.0));
}
`;
