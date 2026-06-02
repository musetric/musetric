export const shader = `
struct SliceSamplesParams {
  windowSize : u32,
  paddedWindowSize : u32,
  windowCount : u32,
  visibleSamples : u32,
  step : f32,
};

@group(0) @binding(0) var<storage, read> samples : array<f32>;
@group(0) @binding(1) var<storage, read_write> signal : array<f32>;
@group(0) @binding(2) var<uniform> params : SliceSamplesParams;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let windowSize = params.windowSize;
  let paddedWindowSize = params.paddedWindowSize;
  let windowCount = params.windowCount;
  let visibleSamples = params.visibleSamples;
  let step = params.step;
  
  let sampleIndex = gid.x;
  let windowIndex = gid.y;
  if (sampleIndex >= paddedWindowSize || windowIndex >= windowCount) {
    return;
  }

  var value : f32 = 0.0;
  if (sampleIndex < windowSize) {
    let srcIndex = u32(f32(windowIndex) * step) + sampleIndex;
    if (srcIndex < visibleSamples) {
      value = samples[srcIndex];
    }
  }
  signal[paddedWindowSize * windowIndex + sampleIndex] = value;
}
`;
