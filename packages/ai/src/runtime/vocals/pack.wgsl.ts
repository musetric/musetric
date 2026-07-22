export const vocalsPackShader = `
override nFft: u32;
override frames: u32;
override packedBins: u32;

@group(0) @binding(0) var<storage, read> wave: array<f32>;
@group(0) @binding(1) var<storage, read_write> stft: array<f32>;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let packed = id.x;
  let frame = id.y;
  if (packed >= packedBins || frame >= frames) {
    return;
  }
  let freq = packed / 2u;
  let channel = packed % 2u;
  let windowIndex = channel * frames + frame;
  let src = windowIndex * (nFft + 2u) + 2u * freq;
  let dst = (packed * frames + frame) * 2u;
  stft[dst] = wave[src];
  stft[dst + 1u] = wave[src + 1u];
}
`;
