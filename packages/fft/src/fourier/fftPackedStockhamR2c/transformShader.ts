export const transformShader = `
override packedWindowSize: u32 = 2048u;
override radix8StageCount: u32 = 0u;
override radix4StageCount: u32 = 0u;
override radix2StageCount: u32 = 0u;
override radix3StageCount: u32 = 0u;
override radix5StageCount: u32 = 0u;

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
};

var<workgroup> smReal0: array<f32, packedWindowSize>;
var<workgroup> smImag0: array<f32, packedWindowSize>;
var<workgroup> smReal1: array<f32, packedWindowSize>;
var<workgroup> smImag1: array<f32, packedWindowSize>;

@group(0) @binding(0) var<storage, read_write> signalReal: array<f32>;
@group(0) @binding(1) var<storage, read_write> signalImag: array<f32>;
@group(0) @binding(2) var<storage, read> fftTrigTable: array<f32>;
@group(0) @binding(3) var<storage, read> r2cTrigTable: array<f32>;
@group(0) @binding(4) var<uniform> params: Params;

fn getFactorCount() -> u32 {
  return radix8StageCount +
    radix4StageCount +
    radix2StageCount +
    radix3StageCount +
    radix5StageCount;
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
  return vec2<f32>(
    a.x * b.x - a.y * b.y,
    a.x * b.y + a.y * b.x,
  );
}

fn getFftTwiddle(index: u32) -> vec2<f32> {
  return vec2<f32>(fftTrigTable[2u * index], -fftTrigTable[2u * index + 1u]);
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
  let factorCount = getFactorCount();
  if ((factorCount & 1u) == 0u) {
    return vec2<f32>(smReal0[index], smImag0[index]);
  }
  return vec2<f32>(smReal1[index], smImag1[index]);
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

fn writeBin(windowOffset: u32, k: u32, value: vec2<f32>) {
  signalReal[windowOffset + k] = value.x;
  signalImag[windowOffset + k] = value.y;
}

fn loadPacked(windowOffset: u32, packedIndex: u32) -> vec2<f32> {
  let s = packedIndex * 2u;
  return vec2<f32>(signalReal[windowOffset + s], signalReal[windowOffset + s + 1u]);
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
  let windowOffset = params.windowSize * windowIndex;

  var stageStride = 1u;
  var firstStage = 0u;

  // Fuse the global load with the first radix-8 stage. That stage has
  // stageStride == 1 so every twiddle is W^0 = 1 (a twiddle-free radix-8),
  // letting us read 8 coalesced inputs straight from global into registers and
  // write the butterfly outputs to shared, skipping one full shared round-trip
  // and one barrier. Only power-of-two sizes start with a radix-8 stage.
  if (radix8StageCount > 0u) {
    let butterflyCount = packedWindowSize / 8u;
    for (var j = t; j < butterflyCount; j += threadCount) {
      let a0 = loadPacked(windowOffset, j);
      let a1 = loadPacked(windowOffset, j + butterflyCount);
      let a2 = loadPacked(windowOffset, j + 2u * butterflyCount);
      let a3 = loadPacked(windowOffset, j + 3u * butterflyCount);
      let a4 = loadPacked(windowOffset, j + 4u * butterflyCount);
      let a5 = loadPacked(windowOffset, j + 5u * butterflyCount);
      let a6 = loadPacked(windowOffset, j + 6u * butterflyCount);
      let a7 = loadPacked(windowOffset, j + 7u * butterflyCount);
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
      let r0 = E0 + p0;
      let r1 = E1 + p1;
      let r2 = E2 + p2;
      let r3 = E3 + p3;
      let r4 = E0 - p0;
      let r5 = E1 - p1;
      let r6 = E2 - p2;
      let r7 = E3 - p3;
      let o0 = j * 8u;
      smReal1[o0] = r0.x; smImag1[o0] = r0.y;
      smReal1[o0 + 1u] = r1.x; smImag1[o0 + 1u] = r1.y;
      smReal1[o0 + 2u] = r2.x; smImag1[o0 + 2u] = r2.y;
      smReal1[o0 + 3u] = r3.x; smImag1[o0 + 3u] = r3.y;
      smReal1[o0 + 4u] = r4.x; smImag1[o0 + 4u] = r4.y;
      smReal1[o0 + 5u] = r5.x; smImag1[o0 + 5u] = r5.y;
      smReal1[o0 + 6u] = r6.x; smImag1[o0 + 6u] = r6.y;
      smReal1[o0 + 7u] = r7.x; smImag1[o0 + 7u] = r7.y;
    }
    workgroupBarrier();
    stageStride = 8u;
    firstStage = 1u;
  } else {
    for (var i = t; i < packedWindowSize; i += threadCount) {
      let sampleIndex = i * 2u;
      smReal0[i] = signalReal[windowOffset + sampleIndex];
      smImag0[i] = signalReal[windowOffset + sampleIndex + 1u];
    }
    workgroupBarrier();
  }

  for (var stage = firstStage; stage < getFactorCount(); stage++) {
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
          getFftTwiddle(tw));
        let a2 = mul(readStage(base + 2u * butterflyCount, readEven),
          getFftTwiddle(2u * tw));
        let a3 = mul(readStage(base + 3u * butterflyCount, readEven),
          getFftTwiddle(3u * tw));
        let a4 = mul(readStage(base + 4u * butterflyCount, readEven),
          getFftTwiddle(4u * tw));
        let a5 = mul(readStage(base + 5u * butterflyCount, readEven),
          getFftTwiddle(5u * tw));
        let a6 = mul(readStage(base + 6u * butterflyCount, readEven),
          getFftTwiddle(6u * tw));
        let a7 = mul(readStage(base + 7u * butterflyCount, readEven),
          getFftTwiddle(7u * tw));
        // even-indexed radix-4
        let e0 = a0 + a4;
        let e1 = a0 - a4;
        let e2 = a2 + a6;
        let e3 = a2 - a6;
        let E0 = e0 + e2;
        let E1 = e1 + vec2<f32>(e3.y, -e3.x);
        let E2 = e0 - e2;
        let E3 = e1 + vec2<f32>(-e3.y, e3.x);
        // odd-indexed radix-4
        let f0 = a1 + a5;
        let f1 = a1 - a5;
        let f2 = a3 + a7;
        let f3 = a3 - a7;
        let O0 = f0 + f2;
        let O1 = f1 + vec2<f32>(f3.y, -f3.x);
        let O2 = f0 - f2;
        let O3 = f1 + vec2<f32>(-f3.y, f3.x);
        // combine with W8^r
        let p0 = O0;
        let p1 = vec2<f32>(
          sqrt1_2 * (O1.x + O1.y),
          sqrt1_2 * (O1.y - O1.x),
        );
        let p2 = vec2<f32>(O2.y, -O2.x);
        let p3 = vec2<f32>(
          sqrt1_2 * (O3.y - O3.x),
          -sqrt1_2 * (O3.x + O3.y),
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
        let bIndex = aIndex + butterflyCount;
        let a = readStage(aIndex, readEven);
        let b = mul(
          readStage(bIndex, readEven),
          getFftTwiddle(k * twiddleScale),
        );
        let outEven = block * (stageStride * 2u) + k;
        let outOdd = outEven + stageStride;
        writeStage(outEven, readEven, a + b);
        writeStage(outOdd, readEven, a - b);
      }
    } else if (factor == 4u) {
      for (var j = t; j < butterflyCount; j += threadCount) {
        let k = j % stageStride;
        let block = j / stageStride;
        let r0 = block * stageStride + k;
        let r1 = r0 + butterflyCount;
        let r2 = r1 + butterflyCount;
        let r3 = r2 + butterflyCount;
        let a0 = readStage(r0, readEven);
        let a1 = mul(readStage(r1, readEven), getFftTwiddle(k * twiddleScale));
        let a2 = mul(
          readStage(r2, readEven),
          getFftTwiddle(2u * k * twiddleScale),
        );
        let a3 = mul(
          readStage(r3, readEven),
          getFftTwiddle(3u * k * twiddleScale),
        );
        let sum02 = a0 + a2;
        let diff02 = a0 - a2;
        let sum13 = a1 + a3;
        let diff13 = a1 - a3;
        let minusIDiff13 = vec2<f32>(diff13.y, -diff13.x);
        let plusIDiff13 = vec2<f32>(-diff13.y, diff13.x);
        let i0 = block * (stageStride * 4u) + k;
        let i1 = i0 + stageStride;
        let i2 = i1 + stageStride;
        let i3 = i2 + stageStride;
        writeStage(i0, readEven, sum02 + sum13);
        writeStage(i1, readEven, diff02 + minusIDiff13);
        writeStage(i2, readEven, sum02 - sum13);
        writeStage(i3, readEven, diff02 + plusIDiff13);
      }
    } else if (factor == 3u) {
      for (var j = t; j < butterflyCount; j += threadCount) {
        let k = j % stageStride;
        let block = j / stageStride;
        let base = block * stageStride + k;
        let tw = k * twiddleScale;
        let a0 = readStage(base, readEven);
        let a1 = mul(readStage(base + butterflyCount, readEven),
          getFftTwiddle(tw));
        let a2 = mul(readStage(base + 2u * butterflyCount, readEven),
          getFftTwiddle(2u * tw));
        let t1 = a1 + a2;
        let m = a0 - 0.5 * t1;
        let d = a2 - a1;
        let ids = vec2<f32>(-sin3 * d.y, sin3 * d.x);
        let o0 = block * (stageStride * 3u) + k;
        writeStage(o0, readEven, a0 + t1);
        writeStage(o0 + stageStride, readEven, m + ids);
        writeStage(o0 + 2u * stageStride, readEven, m - ids);
      }
    } else if (factor == 5u) {
      for (var j = t; j < butterflyCount; j += threadCount) {
        let k = j % stageStride;
        let block = j / stageStride;
        let base = block * stageStride + k;
        let tw = k * twiddleScale;
        let a0 = readStage(base, readEven);
        let a1 = mul(readStage(base + butterflyCount, readEven),
          getFftTwiddle(tw));
        let a2 = mul(readStage(base + 2u * butterflyCount, readEven),
          getFftTwiddle(2u * tw));
        let a3 = mul(readStage(base + 3u * butterflyCount, readEven),
          getFftTwiddle(3u * tw));
        let a4 = mul(readStage(base + 4u * butterflyCount, readEven),
          getFftTwiddle(4u * tw));
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
        writeStage(o1, readEven, b1 + vec2<f32>(b3.y, -b3.x));
        writeStage(o2, readEven, b2 + vec2<f32>(b4.y, -b4.x));
        writeStage(o3, readEven, b2 + vec2<f32>(-b4.y, b4.x));
        writeStage(o4, readEven, b1 + vec2<f32>(-b3.y, b3.x));
      }
    } else {
      for (var j = t; j < butterflyCount; j += threadCount) {
        let k = j % stageStride;
        let block = j / stageStride;
        for (var r = 0u; r < factor; r++) {
          var sum = vec2<f32>(0.0, 0.0);
          for (var q = 0u; q < factor; q++) {
            let inputIndex = block * stageStride + k + q * butterflyCount;
            let twiddleIndex =
              (q * (k * twiddleScale + r * (packedWindowSize / factor))) %
              packedWindowSize;
            var value = readStage(inputIndex, readEven);
            value = mul(value, getFftTwiddle(twiddleIndex));
            sum += value;
          }
          let outputIndex =
            block * (stageStride * factor) + r * stageStride + k;
          writeStage(outputIndex, readEven, sum);
        }
      }
    }

    stageStride *= factor;
    workgroupBarrier();
  }

  // R2C unpack. Bins k and P-k share the pair {res(k), res(P-k)}, so process
  // both per iteration over the lower half, halving shared reads and trip count.
  if (t == 0u) {
    let z0 = getResult(0u);
    writeBin(windowOffset, 0u, vec2<f32>(z0.x + z0.y, 0.0));
    writeBin(windowOffset, packedWindowSize, vec2<f32>(z0.x - z0.y, 0.0));
    if (packedWindowSize % 2u == 0u) {
      let half = packedWindowSize / 2u;
      let zh = getResult(half);
      writeBin(windowOffset, half, r2cBin(half, zh, zh));
    }
  }
  for (var k = t + 1u; 2u * k < packedWindowSize; k += threadCount) {
    let value = getResult(k);
    let mirrorValue = getResult(packedWindowSize - k);
    writeBin(windowOffset, k, r2cBin(k, value, mirrorValue));
    writeBin(windowOffset, packedWindowSize - k,
      r2cBin(packedWindowSize - k, mirrorValue, value));
  }
}
`;
