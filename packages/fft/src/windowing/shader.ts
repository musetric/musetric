export const shader = `
struct WindowingParams {
  windowSize: u32,
  paddedWindowSize: u32,
  windowCount: u32,
};

@group(0) @binding(0) var<storage, read_write> signal: array<f32>;
@group(0) @binding(1) var<uniform> params: WindowingParams;
@group(0) @binding(2) var<storage, read> windowFunction: array<f32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let windowSize = params.windowSize;
  let paddedWindowSize = params.paddedWindowSize;
  let windowCount = params.windowCount;
  
  let sampleIndex = gid.x;
  let windowIndex = gid.y;
  if (sampleIndex >= windowSize || windowIndex >= windowCount) {
    return;
  }
  let offset = paddedWindowSize * windowIndex + sampleIndex;
  let weight = windowFunction[sampleIndex];
  signal[offset] *= weight;
}
`;
