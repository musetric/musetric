import { stockhamCombines } from '../butterflyLadder.wgsl.js';

export const transformInPlaceMixedShader = `
override packedWindowSize: u32 = 2560u;
override positiveWindowSize: u32 = 2561u;
override radix8StageCount: u32 = 0u;
override radix4StageCount: u32 = 0u;
override radix2StageCount: u32 = 0u;
override radix3StageCount: u32 = 0u;
override radix5StageCount: u32 = 0u;
override inPlace: u32 = 1u;
override threadCount: u32 = 256u;
override twiddleSign: f32 = 1.0;

struct Params {
  windowSize: u32,
  windowCount: u32,
  batchOffset: u32,
};

var<workgroup> sm: array<vec2<f32>, packedWindowSize>;

@group(0) @binding(0) var<storage, read> sourceSpectrum: array<f32>;
@group(0) @binding(1) var<storage, read_write> signal: array<f32>;
@group(0) @binding(2) var<storage, read> fftTrigTable: array<f32>;
@group(0) @binding(3) var<storage, read> r2cTrigTable: array<f32>;
@group(0) @binding(4) var<uniform> params: Params;
${stockhamCombines}
fn getFactorCount() -> u32 {
  return radix8StageCount + radix4StageCount + radix2StageCount +
    radix3StageCount + radix5StageCount;
}

fn getFactor(stage: u32) -> u32 {
  if (stage < radix8StageCount) {
    return 8u;
  }
  if (stage < radix8StageCount + radix4StageCount) {
    return 4u;
  }
  if (stage < radix8StageCount + radix4StageCount + radix2StageCount) {
    return 2u;
  }
  if (
    stage <
    radix8StageCount + radix4StageCount + radix2StageCount + radix3StageCount
  ) {
    return 3u;
  }
  return 5u;
}

fn reverseMixed(index: u32) -> u32 {
  var rev = 0u;
  var placeIn = packedWindowSize;
  var placeOut = 1u;
  for (var s = 0u; s < radix8StageCount; s++) {
    placeIn = placeIn / 8u;
    rev = rev + ((index / placeIn) % 8u) * placeOut;
    placeOut = placeOut * 8u;
  }
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

fn getResult(index: u32) -> vec2<f32> {
  return sm[index];
}

fn store(index: u32, value: vec2<f32>) {
  sm[index] = value;
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
  let windowIndex = params.batchOffset + workgroupId.x;
  if (windowIndex >= params.windowCount) {
    return;
  }

  let t = localId.x;
  let spectrumOffset = complexStride() * windowIndex;
  let signalOffset = params.windowSize * windowIndex;

  if (t == 0u) {
    store(0u, loadPackedSpectrum(spectrumOffset, 0u));
    if (packedWindowSize % 2u == 0u) {
      let half = packedWindowSize / 2u;
      store(reverseMixed(half), loadPackedSpectrum(spectrumOffset, half));
    }
  }
  for (var k = t + 1u; 2u * k < packedWindowSize; k += threadCount) {
    let mirrorK = packedWindowSize - k;
    let a = readSpectrumBin(spectrumOffset, k);
    let mirror = readSpectrumBin(spectrumOffset, mirrorK);
    let b = vec2<f32>(mirror.x, -mirror.y);
    let even = 0.5 * (a + b);
    let diff = 0.5 * (a - b);
    let invTwiddle = vec2<f32>(
      r2cTrigTable[2u * k],
      r2cTrigTable[2u * k + 1u],
    );
    let odd = mul(diff, invTwiddle);
    store(reverseMixed(k), vec2<f32>(even.x - odd.y, even.y + odd.x));
    store(reverseMixed(mirrorK), vec2<f32>(even.x + odd.y, odd.x - even.y));
  }
  workgroupBarrier();

  var stride = 1u;
  for (var stage = 0u; stage < getFactorCount(); stage++) {
    let factor = getFactor(stage);
    let butterflyCount = packedWindowSize / factor;
    let twiddleScale = packedWindowSize / (stride * factor);

    if (factor == 8u) {
      for (var j = t; j < butterflyCount; j += threadCount) {
        let k = j % stride;
        let block = j / stride;
        let base = block * (stride * 8u) + k;
        let tw = k * twiddleScale;
        let a0 = getResult(base);
        let a1 = mul(getResult(base + stride), getTwiddle(tw));
        let a2 = mul(getResult(base + 2u * stride), getTwiddle(2u * tw));
        let a3 = mul(getResult(base + 3u * stride), getTwiddle(3u * tw));
        let a4 = mul(getResult(base + 4u * stride), getTwiddle(4u * tw));
        let a5 = mul(getResult(base + 5u * stride), getTwiddle(5u * tw));
        let a6 = mul(getResult(base + 6u * stride), getTwiddle(6u * tw));
        let a7 = mul(getResult(base + 7u * stride), getTwiddle(7u * tw));
        let y = combineRadix8(a0, a1, a2, a3, a4, a5, a6, a7);
        store(base, y[0]);
        store(base + stride, y[1]);
        store(base + 2u * stride, y[2]);
        store(base + 3u * stride, y[3]);
        store(base + 4u * stride, y[4]);
        store(base + 5u * stride, y[5]);
        store(base + 6u * stride, y[6]);
        store(base + 7u * stride, y[7]);
      }
    } else if (factor == 4u) {
      for (var j = t; j < butterflyCount; j += threadCount) {
        let k = j % stride;
        let block = j / stride;
        let base = block * (stride * 4u) + k;
        let tw = k * twiddleScale;
        let a0 = getResult(base);
        let a1 = mul(getResult(base + stride), getTwiddle(tw));
        let a2 = mul(getResult(base + 2u * stride), getTwiddle(2u * tw));
        let a3 = mul(getResult(base + 3u * stride), getTwiddle(3u * tw));
        let y = combineRadix4(a0, a1, a2, a3);
        store(base, y[0]);
        store(base + stride, y[1]);
        store(base + 2u * stride, y[2]);
        store(base + 3u * stride, y[3]);
      }
    } else if (factor == 2u) {
      for (var j = t; j < butterflyCount; j += threadCount) {
        let k = j % stride;
        let block = j / stride;
        let base = block * (stride * 2u) + k;
        let a0 = getResult(base);
        let a1 = mul(getResult(base + stride), getTwiddle(k * twiddleScale));
        let y = combineRadix2(a0, a1);
        store(base, y[0]);
        store(base + stride, y[1]);
      }
    } else if (factor == 3u) {
      for (var j = t; j < butterflyCount; j += threadCount) {
        let k = j % stride;
        let block = j / stride;
        let base = block * (stride * 3u) + k;
        let tw = k * twiddleScale;
        let a0 = getResult(base);
        let a1 = mul(getResult(base + stride), getTwiddle(tw));
        let a2 = mul(getResult(base + 2u * stride), getTwiddle(2u * tw));
        let y = combineRadix3(a0, a1, a2);
        store(base, y[0]);
        store(base + stride, y[1]);
        store(base + 2u * stride, y[2]);
      }
    } else {
      for (var j = t; j < butterflyCount; j += threadCount) {
        let k = j % stride;
        let block = j / stride;
        let base = block * (stride * 5u) + k;
        let tw = k * twiddleScale;
        let a0 = getResult(base);
        let a1 = mul(getResult(base + stride), getTwiddle(tw));
        let a2 = mul(getResult(base + 2u * stride), getTwiddle(2u * tw));
        let a3 = mul(getResult(base + 3u * stride), getTwiddle(3u * tw));
        let a4 = mul(getResult(base + 4u * stride), getTwiddle(4u * tw));
        let y = combineRadix5(a0, a1, a2, a3, a4);
        store(base, y[0]);
        store(base + stride, y[1]);
        store(base + 2u * stride, y[2]);
        store(base + 3u * stride, y[3]);
        store(base + 4u * stride, y[4]);
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
