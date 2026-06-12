// Cuts the chunk into reflect-padded, periodic-Hann-windowed frames laid out
// in the packed (nFft + 2) complex stride expected by the FFT.
export const leadBackingFrameShader = `
override nFft: u32;
override hop: u32;
override pad: i32;
override frames: u32;
override windowCount: u32;
override samples: i32;

const pi: f32 = 3.141592653589793;

@group(0) @binding(0) var<storage, read> rawAudio: array<f32>;
@group(0) @binding(1) var<storage, read_write> wave: array<f32>;

fn reflectIndex(index: i32) -> i32 {
  if (index < 0i) {
    return -index;
  }
  if (index >= samples) {
    return 2i * samples - 2i - index;
  }
  return index;
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let n = id.x;
  let windowIndex = id.y;
  if (n >= nFft || windowIndex >= windowCount) {
    return;
  }
  let channel = windowIndex / frames;
  let frame = windowIndex % frames;
  let sample = reflectIndex(i32(frame * hop + n) - pad);
  let window = 0.5 - 0.5 * cos(2.0 * pi * f32(n) / f32(nFft));
  let dst = windowIndex * (nFft + 2u) + n;
  wave[dst] = rawAudio[channel * u32(samples) + u32(sample)] * window;
}
`;
