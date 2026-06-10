export const transformShader = `
override packedWindowSize: u32 = 1024u;
override positiveWindowSize: u32 = 1025u;
override radix4StageCount: u32 = 0u;
override radix2StageCount: u32 = 0u;
override radix3StageCount: u32 = 0u;
override radix5StageCount: u32 = 0u;
override threadCount: u32 = 64u;

const sin3: f32 = 0.86602540378443864676;
const cos5a: f32 = 0.30901699437494742410;
const cos5b: f32 = -0.80901699437494742410;
const sin5a: f32 = 0.95105651629515357212;
const sin5b: f32 = 0.58778525229247312917;

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

fn getFactorCount() -> u32 {
  return radix4StageCount + radix2StageCount + radix3StageCount + radix5StageCount;
}

fn getFactor(stage: u32) -> u32 {
  if (stage < radix4StageCount) {
    return 4u;
  }
  if (stage < radix4StageCount + radix2StageCount) {
    return 2u;
  }
  if (stage < radix4StageCount + radix2StageCount + radix3StageCount) {
    return 3u;
  }
  return 5u;
}

fn mul(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

// Conjugate twiddle (+sin) turns the forward DIT butterfly into the inverse.
fn getInvTwiddle(index: u32) -> vec2<f32> {
  return vec2<f32>(fftTrigTable[2u * index], fftTrigTable[2u * index + 1u]);
}

fn readStage(index: u32, readEven: bool) -> vec2<f32> {
  if (readEven) {
    return vec2<f32>(smReal0[index], smImag0[index]);
  }
  return vec2<f32>(smReal1[index], smImag1[index]);
}

fn writeStage(index: u32, readEven: bool, value: vec2<f32>) {
  if (readEven) {
    smReal1[index] = value.x;
    smImag1[index] = value.y;
  } else {
    smReal0[index] = value.x;
    smImag0[index] = value.y;
  }
}

fn getResult(index: u32) -> vec2<f32> {
  if ((getFactorCount() & 1u) == 0u) {
    return vec2<f32>(smReal0[index], smImag0[index]);
  }
  return vec2<f32>(smReal1[index], smImag1[index]);
}

// C2R combine: fold the half-spectrum bin k and its mirror (N-k) into the
// packed complex sample feeding the size-(N/2) inverse FFT.
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

@compute @workgroup_size(threadCount)
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

  for (var i = t; i < packedWindowSize; i += threadCount) {
    let packed = loadPackedSpectrum(spectrumOffset, i);
    smReal0[i] = packed.x;
    smImag0[i] = packed.y;
  }
  workgroupBarrier();

  var stageStride = 1u;
  for (var stage = 0u; stage < getFactorCount(); stage++) {
    let factor = getFactor(stage);
    let readEven = (stage & 1u) == 0u;
    let butterflyCount = packedWindowSize / factor;
    let twiddleScale = packedWindowSize / (stageStride * factor);

    if (factor == 2u) {
      for (var j = t; j < butterflyCount; j += threadCount) {
        let k = j % stageStride;
        let block = j / stageStride;
        let aIndex = block * stageStride + k;
        let a = readStage(aIndex, readEven);
        let b = mul(
          readStage(aIndex + butterflyCount, readEven),
          getInvTwiddle(k * twiddleScale),
        );
        let outEven = block * (stageStride * 2u) + k;
        writeStage(outEven, readEven, a + b);
        writeStage(outEven + stageStride, readEven, a - b);
      }
    } else if (factor == 4u) {
      for (var j = t; j < butterflyCount; j += threadCount) {
        let k = j % stageStride;
        let block = j / stageStride;
        let r0 = block * stageStride + k;
        let a0 = readStage(r0, readEven);
        let a1 = mul(readStage(r0 + butterflyCount, readEven),
          getInvTwiddle(k * twiddleScale));
        let a2 = mul(readStage(r0 + 2u * butterflyCount, readEven),
          getInvTwiddle(2u * k * twiddleScale));
        let a3 = mul(readStage(r0 + 3u * butterflyCount, readEven),
          getInvTwiddle(3u * k * twiddleScale));
        let sum02 = a0 + a2;
        let diff02 = a0 - a2;
        let sum13 = a1 + a3;
        let diff13 = a1 - a3;
        let plusIDiff13 = vec2<f32>(-diff13.y, diff13.x);
        let minusIDiff13 = vec2<f32>(diff13.y, -diff13.x);
        let o0 = block * (stageStride * 4u) + k;
        let o1 = o0 + stageStride;
        let o2 = o1 + stageStride;
        let o3 = o2 + stageStride;
        writeStage(o0, readEven, sum02 + sum13);
        writeStage(o1, readEven, diff02 + plusIDiff13);
        writeStage(o2, readEven, sum02 - sum13);
        writeStage(o3, readEven, diff02 + minusIDiff13);
      }
    } else if (factor == 3u) {
      for (var j = t; j < butterflyCount; j += threadCount) {
        let k = j % stageStride;
        let block = j / stageStride;
        let base = block * stageStride + k;
        let tw = k * twiddleScale;
        let a0 = readStage(base, readEven);
        let a1 = mul(readStage(base + butterflyCount, readEven),
          getInvTwiddle(tw));
        let a2 = mul(readStage(base + 2u * butterflyCount, readEven),
          getInvTwiddle(2u * tw));
        let t1 = a1 + a2;
        let m = a0 - 0.5 * t1;
        let d = a2 - a1;
        let ids = vec2<f32>(sin3 * d.y, -sin3 * d.x);
        let o0 = block * (stageStride * 3u) + k;
        writeStage(o0, readEven, a0 + t1);
        writeStage(o0 + stageStride, readEven, m + ids);
        writeStage(o0 + 2u * stageStride, readEven, m - ids);
      }
    } else {
      for (var j = t; j < butterflyCount; j += threadCount) {
        let k = j % stageStride;
        let block = j / stageStride;
        let base = block * stageStride + k;
        let tw = k * twiddleScale;
        let a0 = readStage(base, readEven);
        let a1 = mul(readStage(base + butterflyCount, readEven),
          getInvTwiddle(tw));
        let a2 = mul(readStage(base + 2u * butterflyCount, readEven),
          getInvTwiddle(2u * tw));
        let a3 = mul(readStage(base + 3u * butterflyCount, readEven),
          getInvTwiddle(3u * tw));
        let a4 = mul(readStage(base + 4u * butterflyCount, readEven),
          getInvTwiddle(4u * tw));
        let t1 = a1 + a4;
        let t2 = a2 + a3;
        let t3 = a1 - a4;
        let t4 = a2 - a3;
        let b1 = a0 + cos5a * t1 + cos5b * t2;
        let b2 = a0 + cos5b * t1 + cos5a * t2;
        let b3 = sin5a * t3 + sin5b * t4;
        let b4 = sin5b * t3 - sin5a * t4;
        let o0 = block * (stageStride * 5u) + k;
        let o1 = o0 + stageStride;
        let o2 = o1 + stageStride;
        let o3 = o2 + stageStride;
        let o4 = o3 + stageStride;
        writeStage(o0, readEven, a0 + t1 + t2);
        writeStage(o1, readEven, b1 + vec2<f32>(-b3.y, b3.x));
        writeStage(o2, readEven, b2 + vec2<f32>(-b4.y, b4.x));
        writeStage(o3, readEven, b2 + vec2<f32>(b4.y, -b4.x));
        writeStage(o4, readEven, b1 + vec2<f32>(b3.y, -b3.x));
      }
    }

    stageStride *= factor;
    workgroupBarrier();
  }

  let scale = 1.0 / f32(packedWindowSize);
  for (var i = t; i < packedWindowSize; i += threadCount) {
    let value = getResult(i) * scale;
    signal[signalOffset + 2u * i] = value.x;
    signal[signalOffset + 2u * i + 1u] = value.y;
  }
}
`;
