export const moveShader = `
struct MagnitudifyParams {
  windowSize: u32,
  windowCount: u32,
};

@group(0) @binding(0) var<storage, read_write> signalReal: array<f32>;
@group(0) @binding(1) var<storage, read_write> signalImag: array<f32>;
@group(0) @binding(2) var<uniform> params: MagnitudifyParams;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let windowSize = params.windowSize;
  let windowCount = params.windowCount;
  
  let sampleIndex = gid.x;
  let windowIndex = gid.y;
  let halfSize = windowSize / 2u;
  if (sampleIndex >= halfSize || windowIndex >= windowCount) {
    return;
  }
  let offset = windowSize * windowIndex + sampleIndex;
  let distOffset = halfSize * windowIndex + sampleIndex;
  signalReal[distOffset] = signalImag[offset];
}
`;
