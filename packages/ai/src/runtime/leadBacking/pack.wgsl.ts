// Packs the FFT half-spectra into the model input tensor [1, 4, dimF, dimT]
// (planar [channel, re/im, freq, frame]); the first 3 frequency bins are
// zeroed to match the UVR MDX-Net reference contract.
export const leadBackingPackShader = `
override nFft: u32;
override frames: u32;
override windowCount: u32;
override dimF: u32;
override dimT: u32;

@group(0) @binding(0) var<storage, read> wave: array<f32>;
@group(0) @binding(1) var<storage, read_write> spectrum: array<f32>;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let freq = id.x;
  let windowIndex = id.y;
  if (freq >= dimF || windowIndex >= windowCount) {
    return;
  }
  let channel = windowIndex / frames;
  let frame = windowIndex % frames;
  let src = windowIndex * (nFft + 2u) + 2u * freq;
  var re = wave[src];
  var im = wave[src + 1u];
  if (freq < 3u) {
    re = 0.0;
    im = 0.0;
  }
  let reDst = ((channel * 2u) * dimF + freq) * dimT + frame;
  let imDst = ((channel * 2u + 1u) * dimF + freq) * dimT + frame;
  spectrum[reDst] = re;
  spectrum[imDst] = im;
}
`;
