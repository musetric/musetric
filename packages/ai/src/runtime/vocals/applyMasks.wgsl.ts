export const vocalsApplyMasksShader = `
override nFft: u32;
override frames: u32;
override packedBins: u32;
override chainedMasks: u32;

@group(0) @binding(0) var<storage, read> stft: array<f32>;
@group(0) @binding(1) var<storage, read> masks: array<f32>;
@group(0) @binding(2) var<storage, read_write> spectrum: array<f32>;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let packed = id.x;
  let frame = id.y;
  if (packed >= packedBins || frame >= frames) {
    return;
  }
  let offset = (packed * frames + frame) * 2u;
  let plane = packedBins * frames * 2u;
  var outRe = stft[offset];
  var outIm = stft[offset + 1u];
  for (var mask = 0u; mask < chainedMasks; mask = mask + 1u) {
    let maskRe = masks[mask * plane + offset];
    let maskIm = masks[mask * plane + offset + 1u];
    let re = outRe * maskRe - outIm * maskIm;
    outIm = outRe * maskIm + outIm * maskRe;
    outRe = re;
  }

  let freq = packed / 2u;
  let channel = packed % 2u;
  let windowIndex = channel * frames + frame;
  let dst = windowIndex * (nFft + 2u) + 2u * freq;
  spectrum[dst] = outRe;
  spectrum[dst + 1u] = outIm;
}
`;
