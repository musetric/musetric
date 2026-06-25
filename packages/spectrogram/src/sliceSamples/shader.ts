export const shader = `
struct SliceSamplesParams {
  windowSize : u32,
  paddedWindowSize : u32,
  signalStride : u32,
  windowCount : u32,
  visibleSamples : u32,
  step : f32,
};

@group(0) @binding(0) var<storage, read> samples : array<f32>;
@group(0) @binding(1) var<storage, read_write> signal : array<f32>;
@group(0) @binding(2) var<uniform> params : SliceSamplesParams;
@group(0) @binding(3) var<storage, read> windowFunction : array<f32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let windowSize = params.windowSize;
  let signalStride = params.signalStride;
  let windowCount = params.windowCount;
  let visibleSamples = params.visibleSamples;
  let step = params.step;
  
  let sampleIndex = gid.x;
  let windowIndex = gid.y;
  if (sampleIndex >= windowSize || windowIndex >= windowCount) {
    return;
  }

  var value : f32 = 0.0;
  let srcIndex = u32(f32(windowIndex) * step) + sampleIndex;
  if (srcIndex < visibleSamples) {
    value = samples[srcIndex] * windowFunction[sampleIndex];
  }
  signal[signalStride * windowIndex + sampleIndex] = value;
}
`;
