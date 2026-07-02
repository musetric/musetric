export const transformInPlaceMixedShader = `
override packedWindowSize: u32 = 2560u;
override radix8StageCount: u32 = 0u;
override radix4StageCount: u32 = 0u;
override radix2StageCount: u32 = 0u;
override radix3StageCount: u32 = 0u;
override radix5StageCount: u32 = 0u;
override inPlace: u32 = 1u;
override threadCount: u32 = 256u;

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

var<workgroup> sm: array<vec2<f32>, packedWindowSize>;

@group(0) @binding(0) var<storage, read> wave: array<f32>;
@group(0) @binding(1) var<storage, read_write> spectrum: array<f32>;
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

fn reverseRestMixed(index: u32) -> u32 {
  var rev = 0u;
  var placeIn = packedWindowSize / 8u;
  var placeOut = 1u;
  for (var s = 1u; s < radix8StageCount; s++) {
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

fn complexStride() -> u32 {
  return params.windowSize + 2u;
}

fn getInputWindowOffset(windowIndex: u32) -> u32 {
  if (inPlace == 1u) {
    return complexStride() * windowIndex;
  }
  return params.windowSize * windowIndex;
}

fn readInput(inputOffset: u32, sampleIndex: u32) -> f32 {
  if (inPlace == 1u) {
    return spectrum[inputOffset + sampleIndex];
  }
  return wave[inputOffset + sampleIndex];
}

fn loadPacked(inputOffset: u32, packedIndex: u32) -> vec2<f32> {
  let s = packedIndex * 2u;
  return vec2<f32>(readInput(inputOffset, s), readInput(inputOffset, s + 1u));
}

fn mul(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(
    a.x * b.x - a.y * b.y,
    a.x * b.y + a.y * b.x,
  );
}

fn getFftTwiddle(index: u32) -> vec2<f32> {
  return vec2<f32>(fftTrigTable[2u * index], -fftTrigTable[2u * index + 1u]);
}

fn getResult(index: u32) -> vec2<f32> {
  return sm[index];
}

fn store(index: u32, value: vec2<f32>) {
  sm[index] = value;
}

fn r2cBin(k: u32, value: vec2<f32>, mirrorValue: vec2<f32>) -> vec2<f32> {
  let even = vec2<f32>(
    0.5 * (value.x + mirrorValue.x),
    0.5 * (value.y - mirrorValue.y),
  );
  let odd = vec2<f32>(
    0.5 * (value.y + mirrorValue.y),
    0.5 * (mirrorValue.x - value.x),
  );
  let twiddleReal = r2cTrigTable[2u * k];
  let twiddleImag = -r2cTrigTable[2u * k + 1u];
  let product = vec2<f32>(
    odd.x * twiddleReal - odd.y * twiddleImag,
    odd.x * twiddleImag + odd.y * twiddleReal,
  );
  return even + product;
}

fn writeBin(spectrumOffset: u32, k: u32, value: vec2<f32>) {
  let index = spectrumOffset + 2u * k;
  spectrum[index] = value.x;
  spectrum[index + 1u] = value.y;
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
  let inputOffset = getInputWindowOffset(windowIndex);
  let spectrumOffset = complexStride() * windowIndex;

  var stride = 1u;
  var firstStage = 0u;

  if (radix8StageCount > 0u) {
    let butterflyCount = packedWindowSize / 8u;
    for (var j = t; j < butterflyCount; j += threadCount) {
      let a0 = loadPacked(inputOffset, j);
      let a1 = loadPacked(inputOffset, j + butterflyCount);
      let a2 = loadPacked(inputOffset, j + 2u * butterflyCount);
      let a3 = loadPacked(inputOffset, j + 3u * butterflyCount);
      let a4 = loadPacked(inputOffset, j + 4u * butterflyCount);
      let a5 = loadPacked(inputOffset, j + 5u * butterflyCount);
      let a6 = loadPacked(inputOffset, j + 6u * butterflyCount);
      let a7 = loadPacked(inputOffset, j + 7u * butterflyCount);
      let e0 = a0 + a4;
      let e1 = a0 - a4;
      let e2 = a2 + a6;
      let e3 = a2 - a6;
      let E0 = e0 + e2;
      let E1 = e1 + vec2<f32>(e3.y, -e3.x);
      let E2 = e0 - e2;
      let E3 = e1 + vec2<f32>(-e3.y, e3.x);
      let f0 = a1 + a5;
      let f1 = a1 - a5;
      let f2 = a3 + a7;
      let f3 = a3 - a7;
      let O0 = f0 + f2;
      let O1 = f1 + vec2<f32>(f3.y, -f3.x);
      let O2 = f0 - f2;
      let O3 = f1 + vec2<f32>(-f3.y, f3.x);
      let p0 = O0;
      let p1 = vec2<f32>(sqrt1_2 * (O1.x + O1.y), sqrt1_2 * (O1.y - O1.x));
      let p2 = vec2<f32>(O2.y, -O2.x);
      let p3 = vec2<f32>(sqrt1_2 * (O3.y - O3.x), -sqrt1_2 * (O3.x + O3.y));
      let dst = reverseRestMixed(j) * 8u;
      store(dst, E0 + p0);
      store(dst + 1u, E1 + p1);
      store(dst + 2u, E2 + p2);
      store(dst + 3u, E3 + p3);
      store(dst + 4u, E0 - p0);
      store(dst + 5u, E1 - p1);
      store(dst + 6u, E2 - p2);
      store(dst + 7u, E3 - p3);
    }
    workgroupBarrier();
    stride = 8u;
    firstStage = 1u;
  } else {
    for (var i = t; i < packedWindowSize; i += threadCount) {
      let sampleIndex = i * 2u;
      let value = vec2<f32>(
        readInput(inputOffset, sampleIndex),
        readInput(inputOffset, sampleIndex + 1u),
      );
      store(reverseMixed(i), value);
    }
    workgroupBarrier();
  }

  for (var stage = firstStage; stage < getFactorCount(); stage++) {
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
        let a1 = mul(getResult(base + stride), getFftTwiddle(tw));
        let a2 = mul(getResult(base + 2u * stride), getFftTwiddle(2u * tw));
        let a3 = mul(getResult(base + 3u * stride), getFftTwiddle(3u * tw));
        let a4 = mul(getResult(base + 4u * stride), getFftTwiddle(4u * tw));
        let a5 = mul(getResult(base + 5u * stride), getFftTwiddle(5u * tw));
        let a6 = mul(getResult(base + 6u * stride), getFftTwiddle(6u * tw));
        let a7 = mul(getResult(base + 7u * stride), getFftTwiddle(7u * tw));
        let e0 = a0 + a4;
        let e1 = a0 - a4;
        let e2 = a2 + a6;
        let e3 = a2 - a6;
        let E0 = e0 + e2;
        let E1 = e1 + vec2<f32>(e3.y, -e3.x);
        let E2 = e0 - e2;
        let E3 = e1 + vec2<f32>(-e3.y, e3.x);
        let f0 = a1 + a5;
        let f1 = a1 - a5;
        let f2 = a3 + a7;
        let f3 = a3 - a7;
        let O0 = f0 + f2;
        let O1 = f1 + vec2<f32>(f3.y, -f3.x);
        let O2 = f0 - f2;
        let O3 = f1 + vec2<f32>(-f3.y, f3.x);
        let p0 = O0;
        let p1 = vec2<f32>(sqrt1_2 * (O1.x + O1.y), sqrt1_2 * (O1.y - O1.x));
        let p2 = vec2<f32>(O2.y, -O2.x);
        let p3 = vec2<f32>(sqrt1_2 * (O3.y - O3.x), -sqrt1_2 * (O3.x + O3.y));
        store(base, E0 + p0);
        store(base + stride, E1 + p1);
        store(base + 2u * stride, E2 + p2);
        store(base + 3u * stride, E3 + p3);
        store(base + 4u * stride, E0 - p0);
        store(base + 5u * stride, E1 - p1);
        store(base + 6u * stride, E2 - p2);
        store(base + 7u * stride, E3 - p3);
      }
    } else if (factor == 4u) {
      for (var j = t; j < butterflyCount; j += threadCount) {
        let k = j % stride;
        let block = j / stride;
        let base = block * (stride * 4u) + k;
        let tw = k * twiddleScale;
        let a0 = getResult(base);
        let a1 = mul(getResult(base + stride), getFftTwiddle(tw));
        let a2 = mul(getResult(base + 2u * stride), getFftTwiddle(2u * tw));
        let a3 = mul(getResult(base + 3u * stride), getFftTwiddle(3u * tw));
        let sum02 = a0 + a2;
        let diff02 = a0 - a2;
        let sum13 = a1 + a3;
        let diff13 = a1 - a3;
        let minusIDiff13 = vec2<f32>(diff13.y, -diff13.x);
        let plusIDiff13 = vec2<f32>(-diff13.y, diff13.x);
        store(base, sum02 + sum13);
        store(base + stride, diff02 + minusIDiff13);
        store(base + 2u * stride, sum02 - sum13);
        store(base + 3u * stride, diff02 + plusIDiff13);
      }
    } else if (factor == 2u) {
      for (var j = t; j < butterflyCount; j += threadCount) {
        let k = j % stride;
        let block = j / stride;
        let base = block * (stride * 2u) + k;
        let a = getResult(base);
        let b = mul(getResult(base + stride), getFftTwiddle(k * twiddleScale));
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
        let a1 = mul(getResult(base + stride), getFftTwiddle(tw));
        let a2 = mul(getResult(base + 2u * stride), getFftTwiddle(2u * tw));
        let t1 = a1 + a2;
        let m = a0 - 0.5 * t1;
        let d = a2 - a1;
        let ids = vec2<f32>(-sin3 * d.y, sin3 * d.x);
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
        let a1 = mul(getResult(base + stride), getFftTwiddle(tw));
        let a2 = mul(getResult(base + 2u * stride), getFftTwiddle(2u * tw));
        let a3 = mul(getResult(base + 3u * stride), getFftTwiddle(3u * tw));
        let a4 = mul(getResult(base + 4u * stride), getFftTwiddle(4u * tw));
        let t1 = a1 + a4;
        let t2 = a2 + a3;
        let t3 = a1 - a4;
        let t4 = a2 - a3;
        let b1 = a0 + cos5a * t1 + cos5b * t2;
        let b2 = a0 + cos5b * t1 + cos5a * t2;
        let b3 = sin5a * t3 + sin5b * t4;
        let b4 = sin5b * t3 - sin5a * t4;
        store(base, a0 + t1 + t2);
        store(base + stride, b1 + vec2<f32>(b3.y, -b3.x));
        store(base + 2u * stride, b2 + vec2<f32>(b4.y, -b4.x));
        store(base + 3u * stride, b2 + vec2<f32>(-b4.y, b4.x));
        store(base + 4u * stride, b1 + vec2<f32>(-b3.y, b3.x));
      }
    }

    stride = stride * factor;
    workgroupBarrier();
  }

  if (t == 0u) {
    let z0 = getResult(0u);
    writeBin(spectrumOffset, 0u, vec2<f32>(z0.x + z0.y, 0.0));
    writeBin(spectrumOffset, packedWindowSize, vec2<f32>(z0.x - z0.y, 0.0));
    if (packedWindowSize % 2u == 0u) {
      let half = packedWindowSize / 2u;
      let zh = getResult(half);
      writeBin(spectrumOffset, half, r2cBin(half, zh, zh));
    }
  }
  for (var k = t + 1u; 2u * k < packedWindowSize; k += threadCount) {
    let value = getResult(k);
    let mirrorValue = getResult(packedWindowSize - k);
    writeBin(spectrumOffset, k, r2cBin(k, value, mirrorValue));
    writeBin(spectrumOffset, packedWindowSize - k,
      r2cBin(packedWindowSize - k, mirrorValue, value));
  }
}
`;
