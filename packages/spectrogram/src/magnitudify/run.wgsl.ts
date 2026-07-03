export const runShader = `
struct MagnitudifyParams {
  windowSize: u32,
  windowCount: u32,
  slotOffset: u32,
  padding: u32,
};

@group(0) @binding(0) var<storage, read_write> signal: array<f32>;
@group(0) @binding(1) var<storage, read_write> magnitude: array<f32>;
@group(0) @binding(2) var<uniform> params: MagnitudifyParams;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let windowSize = params.windowSize;
  let windowCount = params.windowCount;

  let sampleIndex = gid.x;
  let localWindowIndex = gid.y;
  let windowIndex = (params.slotOffset + localWindowIndex) % windowCount;
  let halfSize = windowSize / 2u;
  if (sampleIndex >= halfSize || localWindowIndex >= windowCount) {
    return;
  }
  let complexStride = windowSize + 2u;
  let spectrumOffset = complexStride * windowIndex + 2u * sampleIndex;
  let magnitudeOffset = halfSize * windowIndex + sampleIndex;
  let real = signal[spectrumOffset];
  let imag = signal[spectrumOffset + 1u];
  magnitude[magnitudeOffset] = real * real + imag * imag;
}
`;
