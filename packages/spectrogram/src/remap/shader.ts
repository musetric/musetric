export const shader = `
struct RemapParams {
  halfSize: u32,
  width: u32,
  height: u32,
  windowSize: u32,
  sampleRate: f32,
  logMinFrequency: f32,
  logFrequencyRange: f32,
};

@group(0) @binding(0) var<storage, read> signal: array<f32>;
@group(0) @binding(1) var texture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params: RemapParams;

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
  let lowerIntensity = signal[offset + lowerIndex];
  let upperIntensity = signal[offset + upperIndex];
  let intensity = clamp(
    mix(lowerIntensity, upperIntensity, blend) * displayFrequencyTilt(frequency),
    0.0,
    1.0,
  );
  textureStore(texture, vec2u(x, y), vec4f(intensity, 0.0, 0.0, 1.0));
}
`;
