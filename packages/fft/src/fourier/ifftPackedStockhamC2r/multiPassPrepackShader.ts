export const multiPassPrepackShader = `
override packedWindowSize: u32 = 2560u;
override positiveWindowSize: u32 = 2561u;
override writeBufferIndex: u32 = 1u;
override inPlace: u32 = 1u;

const threadCount: u32 = 64u;

struct Params {
  windowSize: u32,
  windowCount: u32,
};

@group(0) @binding(0) var<storage, read> sourceSpectrum: array<f32>;
@group(0) @binding(1) var<storage, read> signalSpectrum: array<f32>;
@group(0) @binding(2) var<storage, read_write> scratch0: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read_write> scratch1: array<vec2<f32>>;
@group(0) @binding(4) var<storage, read> r2cTrigTable: array<f32>;
@group(0) @binding(5) var<uniform> params: Params;

fn mul(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

// C2R combine: fold the half-spectrum bin k and its mirror (N-k) into the
// packed complex sample feeding the size-(N/2) inverse FFT.
fn complexStride() -> u32 {
  return params.windowSize + 2u;
}

fn readSpectrumFloat(spectrumOffset: u32, index: u32) -> f32 {
  if (inPlace == 1u) {
    return signalSpectrum[spectrumOffset + index];
  }
  return sourceSpectrum[spectrumOffset + index];
}

fn readSpectrumBin(spectrumOffset: u32, k: u32) -> vec2<f32> {
  let index = 2u * k;
  return vec2<f32>(
    readSpectrumFloat(spectrumOffset, index),
    readSpectrumFloat(spectrumOffset, index + 1u),
  );
}

fn loadPackedSpectrum(spectrumOffset: u32, k: u32) -> vec2<f32> {
  if (k == 0u) {
    let dc = readSpectrumFloat(spectrumOffset, 0u);
    let nyquist = readSpectrumFloat(spectrumOffset, 2u * packedWindowSize);
    return vec2<f32>(0.5 * (dc + nyquist), 0.5 * (dc - nyquist));
  }

  let mirrorK = packedWindowSize - k;
  let a = readSpectrumBin(spectrumOffset, k);
  let mirror = readSpectrumBin(spectrumOffset, mirrorK);
  let b = vec2<f32>(mirror.x, -mirror.y);
  let even = 0.5 * (a + b);
  let diff = 0.5 * (a - b);
  let invTwiddle = vec2<f32>(r2cTrigTable[2u * k], r2cTrigTable[2u * k + 1u]);
  let odd = mul(diff, invTwiddle);
  return even + vec2<f32>(-odd.y, odd.x);
}

fn writeScratch(index: u32, value: vec2<f32>) {
  if (writeBufferIndex == 0u) {
    scratch0[index] = value;
  } else {
    scratch1[index] = value;
  }
}

@compute @workgroup_size(threadCount)
fn main(
  @builtin(workgroup_id) workgroupId: vec3<u32>,
  @builtin(local_invocation_id) localId: vec3<u32>,
) {
  let windowIndex = workgroupId.x;
  if (windowIndex >= params.windowCount) {
    return;
  }

  let k = workgroupId.y * threadCount + localId.x;
  if (k >= packedWindowSize) {
    return;
  }

  let spectrumOffset = complexStride() * windowIndex;
  let scratchOffset = packedWindowSize * windowIndex;
  writeScratch(scratchOffset + k, loadPackedSpectrum(spectrumOffset, k));
}
`;
