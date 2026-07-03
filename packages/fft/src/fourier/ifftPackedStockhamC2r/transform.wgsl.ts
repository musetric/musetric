export const transformShader = `
override packedWindowSize: u32 = 1024u;
override positiveWindowSize: u32 = 1025u;
override radix8StageCount: u32 = 0u;
override radix4StageCount: u32 = 0u;
override radix2StageCount: u32 = 0u;
override radix3StageCount: u32 = 0u;
override radix5StageCount: u32 = 0u;
override inPlace: u32 = 1u;
override threadCount: u32 = 64u;

const sqrt1_2: f32 = 0.70710678118654752440;
const sin3: f32 = 0.86602540378443864676;
const cos5a: f32 = 0.30901699437494742410;
const cos5b: f32 = -0.80901699437494742410;
const sin5a: f32 = 0.95105651629515357212;
const sin5b: f32 = 0.58778525229247312917;

struct Params {
  windowSize: u32,
  windowCount: u32,
  batchOffset: u32,
};

var<workgroup> sm0: array<vec2<f32>, packedWindowSize>;
var<workgroup> sm1: array<vec2<f32>, packedWindowSize>;

@group(0) @binding(0) var<storage, read> sourceSpectrum: array<f32>;
@group(0) @binding(1) var<storage, read_write> signal: array<f32>;
@group(0) @binding(2) var<storage, read> fftTrigTable: array<f32>;
@group(0) @binding(3) var<storage, read> r2cTrigTable: array<f32>;
@group(0) @binding(4) var<uniform> params: Params;

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

fn mul(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

fn getInvTwiddle(index: u32) -> vec2<f32> {
  return vec2<f32>(fftTrigTable[2u * index], fftTrigTable[2u * index + 1u]);
}

fn readStage(index: u32, readEven: bool) -> vec2<f32> {
  if (readEven) {
    return sm0[index];
  }
  return sm1[index];
}

fn writeStage(index: u32, readEven: bool, value: vec2<f32>) {
  if (readEven) {
    sm1[index] = value;
  } else {
    sm0[index] = value;
  }
}

fn getResult(index: u32) -> vec2<f32> {
  if ((getFactorCount() & 1u) == 0u) {
    return sm0[index];
  }
  return sm1[index];
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
    sm0[0u] = loadPackedSpectrum(spectrumOffset, 0u);
    if (packedWindowSize % 2u == 0u) {
      let half = packedWindowSize / 2u;
      sm0[half] = loadPackedSpectrum(spectrumOffset, half);
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
    sm0[k] = vec2<f32>(even.x - odd.y, even.y + odd.x);
    sm0[mirrorK] = vec2<f32>(even.x + odd.y, odd.x - even.y);
  }
  workgroupBarrier();

  var stageStride = 1u;
  for (var stage = 0u; stage < getFactorCount(); stage++) {
    let factor = getFactor(stage);
    let readEven = (stage & 1u) == 0u;
    let butterflyCount = packedWindowSize / factor;
    let twiddleScale = packedWindowSize / (stageStride * factor);

    if (factor == 8u) {
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
        let a5 = mul(readStage(base + 5u * butterflyCount, readEven),
          getInvTwiddle(5u * tw));
        let a6 = mul(readStage(base + 6u * butterflyCount, readEven),
          getInvTwiddle(6u * tw));
        let a7 = mul(readStage(base + 7u * butterflyCount, readEven),
          getInvTwiddle(7u * tw));
        let e0 = a0 + a4;
        let e1 = a0 - a4;
        let e2 = a2 + a6;
        let e3 = a2 - a6;
        let E0 = e0 + e2;
        let E1 = e1 + vec2<f32>(-e3.y, e3.x);
        let E2 = e0 - e2;
        let E3 = e1 + vec2<f32>(e3.y, -e3.x);
        let f0 = a1 + a5;
        let f1 = a1 - a5;
        let f2 = a3 + a7;
        let f3 = a3 - a7;
        let O0 = f0 + f2;
        let O1 = f1 + vec2<f32>(-f3.y, f3.x);
        let O2 = f0 - f2;
        let O3 = f1 + vec2<f32>(f3.y, -f3.x);
        let p0 = O0;
        let p1 = vec2<f32>(
          sqrt1_2 * (O1.x - O1.y),
          sqrt1_2 * (O1.x + O1.y),
        );
        let p2 = vec2<f32>(-O2.y, O2.x);
        let p3 = vec2<f32>(
          -sqrt1_2 * (O3.x + O3.y),
          sqrt1_2 * (O3.x - O3.y),
        );
        let o0 = block * (stageStride * 8u) + k;
        let o1 = o0 + stageStride;
        let o2 = o1 + stageStride;
        let o3 = o2 + stageStride;
        let o4 = o3 + stageStride;
        let o5 = o4 + stageStride;
        let o6 = o5 + stageStride;
        let o7 = o6 + stageStride;
        writeStage(o0, readEven, E0 + p0);
        writeStage(o1, readEven, E1 + p1);
        writeStage(o2, readEven, E2 + p2);
        writeStage(o3, readEven, E3 + p3);
        writeStage(o4, readEven, E0 - p0);
        writeStage(o5, readEven, E1 - p1);
        writeStage(o6, readEven, E2 - p2);
        writeStage(o7, readEven, E3 - p3);
      }
    } else if (factor == 2u) {
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
