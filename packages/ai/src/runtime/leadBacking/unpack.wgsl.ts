export const leadBackingUnpackShader = `
override nFft: u32;
override frames: u32;
override windowCount: u32;
override dimF: u32;
override dimT: u32;
override freqs: u32;

@group(0) @binding(0) var<storage, read> spectrum: array<f32>;
@group(0) @binding(1) var<storage, read_write> halfSpectrum: array<f32>;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let freq = id.x;
  let windowIndex = id.y;
  if (freq >= freqs || windowIndex >= windowCount) {
    return;
  }
  let channel = windowIndex / frames;
  let frame = windowIndex % frames;
  var re = 0.0;
  var im = 0.0;
  if (freq < dimF) {
    re = spectrum[((channel * 2u) * dimF + freq) * dimT + frame];
    im = spectrum[((channel * 2u + 1u) * dimF + freq) * dimT + frame];
  }
  let dst = windowIndex * (nFft + 2u) + 2u * freq;
  halfSpectrum[dst] = re;
  halfSpectrum[dst + 1u] = im;
}
`;
