// Overlap-adds the inverse-FFT frames with the synthesis Hann window and
// normalizes by the squared-window envelope, undoing the analysis padding.
export const leadBackingOverlapAddShader = `
override nFft: u32;
override hop: u32;
override pad: i32;
override frames: u32;
override channels: u32;
override samples: u32;

const pi: f32 = 3.141592653589793;

@group(0) @binding(0) var<storage, read> framesTime: array<f32>;
@group(0) @binding(1) var<storage, read_write> audio: array<f32>;

fn hann(n: u32) -> f32 {
  return 0.5 - 0.5 * cos(2.0 * pi * f32(n) / f32(nFft));
}

fn floorDiv(a: i32, b: i32) -> i32 {
  var q = a / b;
  let r = a % b;
  if (r != 0i && ((r < 0i) != (b < 0i))) {
    q = q - 1i;
  }
  return q;
}

fn ceilDiv(a: i32, b: i32) -> i32 {
  return -floorDiv(-a, b);
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index >= channels * samples) {
    return;
  }
  let channel = index / samples;
  let sample = index % samples;
  let padded = i32(sample) + pad;
  var firstFrame = ceilDiv(padded - i32(nFft) + 1i, i32(hop));
  var lastFrame = floorDiv(padded, i32(hop));
  firstFrame = max(firstFrame, 0i);
  lastFrame = min(lastFrame, i32(frames) - 1i);
  if (firstFrame > lastFrame) {
    audio[index] = 0.0;
    return;
  }

  var sum = 0.0;
  var envelope = 0.0;
  let first = u32(firstFrame);
  let last = u32(lastFrame);
  for (var frame = first; frame <= last; frame = frame + 1u) {
    let n = u32(padded - i32(frame) * i32(hop));
    let window = hann(n);
    let windowIndex = channel * frames + frame;
    sum = sum + framesTime[windowIndex * nFft + n] * window;
    envelope = envelope + window * window;
  }
  audio[index] = sum / max(envelope, 1e-8);
}
`;
