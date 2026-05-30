export const transformInPlaceMixedShader = `
override packedWindowSize: u32 = 2560u;
override positiveWindowSize: u32 = 2561u;
override radix4StageCount: u32 = 0u;
override radix2StageCount: u32 = 0u;
override radix3StageCount: u32 = 0u;
override radix5StageCount: u32 = 0u;
override inPlace: u32 = 1u;
override threadCount: u32 = 256u;

const sin3: f32 = 0.86602540378443864676;
const cos5a: f32 = 0.30901699437494742410;
const cos5b: f32 = -0.80901699437494742410;
const sin5a: f32 = 0.95105651629515357212;
const sin5b: f32 = 0.58778525229247312917;

struct Params {
  windowSize: u32,
  windowCount: u32,
};

var<workgroup> smReal: array<f32, packedWindowSize>;
var<workgroup> smImag: array<f32, packedWindowSize>;

@group(0) @binding(0) var<storage, read> sourceSpectrum: array<f32>;
@group(0) @binding(1) var<storage, read_write> signal: array<f32>;
@group(0) @binding(2) var<storage, read> fftTrigTable: array<f32>;
@group(0) @binding(3) var<storage, read> r2cTrigTable: array<f32>;
@group(0) @binding(4) var<uniform> params: Params;

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

// Mixed-radix digit reversal for the in-place DIT, digits in getFactor order.
fn reverseMixed(index: u32) -> u32 {
  var rev = 0u;
  var placeIn = packedWindowSize;
  var placeOut = 1u;
  for (var s = 0u; s < radix4StageCount; s++) {
    placeIn = placeIn / 4u;
    rev = rev + ((index / placeIn) % 4u) * placeOut;
    placeOut = placeOut * 4u;
  }
  for (var s = 0u; s < radix2StageCount; s++) {
    placeIn = placeIn / 2u;
    rev = rev + ((index / placeIn) % 2u) * placeOut;
    placeOut = placeOut * 2u;
  }
  for (var s = 0u; s < radix3StageCount; s++) {
    placeIn = placeIn / 3u;
    rev = rev + ((index / placeIn) % 3u) * placeOut;
    placeOut = placeOut * 3u;
  }
  for (var s = 0u; s < radix5StageCount; s++) {
    placeIn = placeIn / 5u;
    rev = rev + ((index / placeIn) % 5u) * placeOut;
    placeOut = placeOut * 5u;
  }
  return rev;
}

fn mul(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

// Conjugate twiddle (+sin) for the inverse DIT.
fn getInvTwiddle(index: u32) -> vec2<f32> {
  return vec2<f32>(fftTrigTable[2u * index], fftTrigTable[2u * index + 1u]);
}

fn getResult(index: u32) -> vec2<f32> {
  return vec2<f32>(smReal[index], smImag[index]);
}

fn store(index: u32, value: vec2<f32>) {
  smReal[index] = value.x;
  smImag[index] = value.y;
}

fn complexStride() -> u32 {
  return params.windowSize + 2u;
}

fn readSpectrumFloat(spectrumOffset: u32, index: u32) -> f32 {
  if (inPlace == 1u) {
    return signal[spectrumOffset + index];
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
  let spectrumOffset = complexStride() * windowIndex;
  let signalOffset = params.windowSize * windowIndex;

  for (var i = t; i < packedWindowSize; i += threadCount) {
    store(reverseMixed(i), loadPackedSpectrum(spectrumOffset, i));
  }
  workgroupBarrier();

  var stride = 1u;
  for (var stage = 0u; stage < getFactorCount(); stage++) {
    let factor = getFactor(stage);
    let butterflyCount = packedWindowSize / factor;
    let twiddleScale = packedWindowSize / (stride * factor);

    if (factor == 4u) {
      for (var j = t; j < butterflyCount; j += threadCount) {
        let k = j % stride;
        let block = j / stride;
        let base = block * (stride * 4u) + k;
        let tw = k * twiddleScale;
        let a0 = getResult(base);
        let a1 = mul(getResult(base + stride), getInvTwiddle(tw));
        let a2 = mul(getResult(base + 2u * stride), getInvTwiddle(2u * tw));
        let a3 = mul(getResult(base + 3u * stride), getInvTwiddle(3u * tw));
        let sum02 = a0 + a2;
        let diff02 = a0 - a2;
        let sum13 = a1 + a3;
        let diff13 = a1 - a3;
        let plusIDiff13 = vec2<f32>(-diff13.y, diff13.x);
        let minusIDiff13 = vec2<f32>(diff13.y, -diff13.x);
        store(base, sum02 + sum13);
        store(base + stride, diff02 + plusIDiff13);
        store(base + 2u * stride, sum02 - sum13);
        store(base + 3u * stride, diff02 + minusIDiff13);
      }
    } else if (factor == 2u) {
      for (var j = t; j < butterflyCount; j += threadCount) {
        let k = j % stride;
        let block = j / stride;
        let base = block * (stride * 2u) + k;
        let a = getResult(base);
        let b = mul(getResult(base + stride), getInvTwiddle(k * twiddleScale));
        store(base, a + b);
        store(base + stride, a - b);
      }
    } else if (factor == 3u) {
      for (var j = t; j < butterflyCount; j += threadCount) {
        let k = j % stride;
        let block = j / stride;
        let base = block * (stride * 3u) + k;
        let tw = k * twiddleScale;
        let a0 = getResult(base);
        let a1 = mul(getResult(base + stride), getInvTwiddle(tw));
        let a2 = mul(getResult(base + 2u * stride), getInvTwiddle(2u * tw));
        let t1 = a1 + a2;
        let m = a0 - 0.5 * t1;
        let d = a2 - a1;
        let ids = vec2<f32>(sin3 * d.y, -sin3 * d.x);
        store(base, a0 + t1);
        store(base + stride, m + ids);
        store(base + 2u * stride, m - ids);
      }
    } else {
      for (var j = t; j < butterflyCount; j += threadCount) {
        let k = j % stride;
        let block = j / stride;
        let base = block * (stride * 5u) + k;
        let tw = k * twiddleScale;
        let a0 = getResult(base);
        let a1 = mul(getResult(base + stride), getInvTwiddle(tw));
        let a2 = mul(getResult(base + 2u * stride), getInvTwiddle(2u * tw));
        let a3 = mul(getResult(base + 3u * stride), getInvTwiddle(3u * tw));
        let a4 = mul(getResult(base + 4u * stride), getInvTwiddle(4u * tw));
        let t1 = a1 + a4;
        let t2 = a2 + a3;
        let t3 = a1 - a4;
        let t4 = a2 - a3;
        let b1 = a0 + cos5a * t1 + cos5b * t2;
        let b2 = a0 + cos5b * t1 + cos5a * t2;
        let b3 = sin5a * t3 + sin5b * t4;
        let b4 = sin5b * t3 - sin5a * t4;
        store(base, a0 + t1 + t2);
        store(base + stride, b1 + vec2<f32>(-b3.y, b3.x));
        store(base + 2u * stride, b2 + vec2<f32>(-b4.y, b4.x));
        store(base + 3u * stride, b2 + vec2<f32>(b4.y, -b4.x));
        store(base + 4u * stride, b1 + vec2<f32>(b3.y, -b3.x));
      }
    }

    stride = stride * factor;
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
