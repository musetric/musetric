export const cqtFrameShader = `
struct Params {
  sampleCount: u32,
  frameCount: u32,
  hopLength: u32,
  fftSize: u32,
};

@group(0) @binding(0) var<storage, read> input: array<f32>;
@group(0) @binding(1) var<storage, read_write> wave: array<f32>;
@group(0) @binding(2) var<uniform> params: Params;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let sampleInFrame = id.x;
  let frameIndex = id.y;
  if (sampleInFrame >= params.fftSize || frameIndex >= params.frameCount) {
    return;
  }
  let offset = i32(frameIndex * params.hopLength + sampleInFrame) -
    i32(params.fftSize / 2u);
  let spectrumStride = params.fftSize + 2u;
  let outputIndex = frameIndex * spectrumStride + sampleInFrame;
  if (offset < 0 || offset >= i32(params.sampleCount)) {
    wave[outputIndex] = 0.0;
    return;
  }
  wave[outputIndex] = input[u32(offset)];
}
`;
