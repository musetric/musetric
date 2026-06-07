export const transformShader = `
override packedWindowSize: u32 = 1024u;
override positiveWindowSize: u32 = 1025u;
override log2PackedWindowSize: u32 = 10u;

struct Params {
  windowSize: u32,
  windowCount: u32,
};

var<workgroup> smReal0: array<f32, packedWindowSize>;
var<workgroup> smImag0: array<f32, packedWindowSize>;
var<workgroup> smReal1: array<f32, packedWindowSize>;
var<workgroup> smImag1: array<f32, packedWindowSize>;

@group(0) @binding(0) var<storage, read> spectrumReal: array<f32>;
@group(0) @binding(1) var<storage, read> spectrumImag: array<f32>;
@group(0) @binding(2) var<storage, read_write> signal: array<f32>;
@group(0) @binding(3) var<storage, read> fftTrigTable: array<f32>;
@group(0) @binding(4) var<storage, read> r2cTrigTable: array<f32>;
@group(0) @binding(5) var<uniform> params: Params;

fn getResult(index: u32) -> vec2<f32> {
  if ((log2PackedWindowSize & 1u) == 0u) {
    return vec2<f32>(smReal0[index], smImag0[index]);
  }
  return vec2<f32>(smReal1[index], smImag1[index]);
}

fn mul(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

fn loadPackedSpectrum(spectrumOffset: u32, k: u32) -> vec2<f32> {
  if (k == 0u) {
    let dc = spectrumReal[spectrumOffset];
    let nyquist = spectrumReal[spectrumOffset + packedWindowSize];
    return vec2<f32>(0.5 * (dc + nyquist), 0.5 * (dc - nyquist));
  }

  let mirrorK = packedWindowSize - k;
  let a = vec2<f32>(
    spectrumReal[spectrumOffset + k],
    spectrumImag[spectrumOffset + k],
  );
  let b = vec2<f32>(
    spectrumReal[spectrumOffset + mirrorK],
    -spectrumImag[spectrumOffset + mirrorK],
  );
  let even = 0.5 * (a + b);
  let diff = 0.5 * (a - b);
  let invTwiddle = vec2<f32>(r2cTrigTable[2u * k], r2cTrigTable[2u * k + 1u]);
  let odd = mul(diff, invTwiddle);
  return even + vec2<f32>(-odd.y, odd.x);
}

@compute @workgroup_size(64)
fn main(
  @builtin(workgroup_id) workgroupId: vec3<u32>,
  @builtin(local_invocation_id) localId: vec3<u32>,
) {
  let windowIndex = workgroupId.x;
  if (windowIndex >= params.windowCount) {
    return;
  }

  let t = localId.x;
  let spectrumOffset = positiveWindowSize * windowIndex;
  let signalOffset = params.windowSize * windowIndex;

  for (var i = t; i < packedWindowSize; i += 64u) {
    let packed = loadPackedSpectrum(spectrumOffset, i);
    smReal0[i] = packed.x;
    smImag0[i] = packed.y;
  }
  workgroupBarrier();

  let halfPackedWindowSize = packedWindowSize >> 1u;
  for (var stage: u32 = 0u; stage < log2PackedWindowSize; stage++) {
    let stride = 1u << stage;
    let evenStage = (stage & 1u) == 0u;

    for (var j = t; j < halfPackedWindowSize; j += 64u) {
      let k = j % stride;
      let block = j / stride;
      let aIndex = block * stride + k;
      let bIndex = aIndex + halfPackedWindowSize;
      let outEven = block * (stride << 1u) + k;
      let outOdd = outEven + stride;
      let trigIndex = k * (halfPackedWindowSize / stride);
      let twiddleReal = fftTrigTable[2u * trigIndex];
      let twiddleImag = fftTrigTable[2u * trigIndex + 1u];

      var aReal: f32;
      var aImag: f32;
      var bReal: f32;
      var bImag: f32;
      if (evenStage) {
        aReal = smReal0[aIndex];
        aImag = smImag0[aIndex];
        bReal = smReal0[bIndex];
        bImag = smImag0[bIndex];
      } else {
        aReal = smReal1[aIndex];
        aImag = smImag1[aIndex];
        bReal = smReal1[bIndex];
        bImag = smImag1[bIndex];
      }

      let productReal = bReal * twiddleReal - bImag * twiddleImag;
      let productImag = bReal * twiddleImag + bImag * twiddleReal;

      if (evenStage) {
        smReal1[outEven] = aReal + productReal;
        smImag1[outEven] = aImag + productImag;
        smReal1[outOdd] = aReal - productReal;
        smImag1[outOdd] = aImag - productImag;
      } else {
        smReal0[outEven] = aReal + productReal;
        smImag0[outEven] = aImag + productImag;
        smReal0[outOdd] = aReal - productReal;
        smImag0[outOdd] = aImag - productImag;
      }
    }
    workgroupBarrier();
  }

  let scale = 1.0 / f32(packedWindowSize);
  for (var i = t; i < packedWindowSize; i += 64u) {
    let value = getResult(i) * scale;
    signal[signalOffset + 2u * i] = value.x;
    signal[signalOffset + 2u * i + 1u] = value.y;
  }
}
`;
