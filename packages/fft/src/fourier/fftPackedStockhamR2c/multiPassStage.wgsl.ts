export const multiPassStageShader = `
override packedWindowSize: u32 = 2560u;
override factor: u32 = 5u;
override stageStride: u32 = 1u;
override readFromInput: u32 = 1u;
override readBufferIndex: u32 = 0u;
override writeBufferIndex: u32 = 0u;
override inPlace: u32 = 1u;
override fuseR2cPack: u32 = 0u;

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

@group(0) @binding(0) var<storage, read> wave: array<f32>;
@group(0) @binding(1) var<storage, read_write> spectrum: array<f32>;
@group(0) @binding(2) var<storage, read_write> scratch0: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read_write> scratch1: array<vec2<f32>>;
@group(0) @binding(4) var<storage, read> fftTrigTable: array<f32>;
@group(0) @binding(5) var<uniform> params: Params;
@group(0) @binding(6) var<storage, read> r2cTrigTable: array<f32>;

var<private> yOut: array<vec2<f32>, 8>;

fn mul(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(
    a.x * b.x - a.y * b.y,
    a.x * b.y + a.y * b.x,
  );
}

fn getFftTwiddle(index: u32) -> vec2<f32> {
  return vec2<f32>(fftTrigTable[2u * index], -fftTrigTable[2u * index + 1u]);
}

fn readScratch(index: u32) -> vec2<f32> {
  if (readBufferIndex == 0u) {
    return scratch0[index];
  }
  return scratch1[index];
}

fn writeScratch(index: u32, value: vec2<f32>) {
  if (writeBufferIndex == 0u) {
    scratch0[index] = value;
  } else {
    scratch1[index] = value;
  }
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

fn readStage(windowIndex: u32, index: u32) -> vec2<f32> {
  if (readFromInput == 1u) {
    let inputOffset = getInputWindowOffset(windowIndex);
    let sampleIndex = index * 2u;
    return vec2<f32>(
      readInput(inputOffset, sampleIndex),
      readInput(inputOffset, sampleIndex + 1u),
    );
  }

  return readScratch(packedWindowSize * windowIndex + index);
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
  let twiddle = vec2<f32>(r2cTrigTable[2u * k], -r2cTrigTable[2u * k + 1u]);
  return even + mul(odd, twiddle);
}

fn writeBin(spectrumOffset: u32, k: u32, value: vec2<f32>) {
  let index = spectrumOffset + 2u * k;
  spectrum[index] = value.x;
  spectrum[index + 1u] = value.y;
}

fn computeLastButterfly(windowIndex: u32, k: u32) {
  let butterflyCount = packedWindowSize / factor;
  let a0 = readStage(windowIndex, k);
  if (factor == 2u) {
    let b = mul(readStage(windowIndex, k + butterflyCount), getFftTwiddle(k));
    yOut[0] = a0 + b;
    yOut[1] = a0 - b;
    return;
  }
  if (factor == 4u) {
    let a1 = mul(readStage(windowIndex, k + butterflyCount), getFftTwiddle(k));
    let a2 = mul(readStage(windowIndex, k + 2u * butterflyCount),
      getFftTwiddle(2u * k));
    let a3 = mul(readStage(windowIndex, k + 3u * butterflyCount),
      getFftTwiddle(3u * k));
    let sum02 = a0 + a2;
    let diff02 = a0 - a2;
    let sum13 = a1 + a3;
    let diff13 = a1 - a3;
    yOut[0] = sum02 + sum13;
    yOut[1] = diff02 + vec2<f32>(diff13.y, -diff13.x);
    yOut[2] = sum02 - sum13;
    yOut[3] = diff02 + vec2<f32>(-diff13.y, diff13.x);
    return;
  }
  if (factor == 3u) {
    let a1 = mul(readStage(windowIndex, k + butterflyCount), getFftTwiddle(k));
    let a2 = mul(readStage(windowIndex, k + 2u * butterflyCount),
      getFftTwiddle(2u * k));
    let t1 = a1 + a2;
    let m = a0 - 0.5 * t1;
    let d = a2 - a1;
    let ids = vec2<f32>(-sin3 * d.y, sin3 * d.x);
    yOut[0] = a0 + t1;
    yOut[1] = m + ids;
    yOut[2] = m - ids;
    return;
  }
  if (factor == 5u) {
    let a1 = mul(readStage(windowIndex, k + butterflyCount), getFftTwiddle(k));
    let a2 = mul(readStage(windowIndex, k + 2u * butterflyCount),
      getFftTwiddle(2u * k));
    let a3 = mul(readStage(windowIndex, k + 3u * butterflyCount),
      getFftTwiddle(3u * k));
    let a4 = mul(readStage(windowIndex, k + 4u * butterflyCount),
      getFftTwiddle(4u * k));
    let t1 = a1 + a4;
    let t2 = a2 + a3;
    let t3 = a1 - a4;
    let t4 = a2 - a3;
    let b1 = a0 + cos5a * t1 + cos5b * t2;
    let b2 = a0 + cos5b * t1 + cos5a * t2;
    let b3 = sin5a * t3 + sin5b * t4;
    let b4 = sin5b * t3 - sin5a * t4;
    yOut[0] = a0 + t1 + t2;
    yOut[1] = b1 + vec2<f32>(b3.y, -b3.x);
    yOut[2] = b2 + vec2<f32>(b4.y, -b4.x);
    yOut[3] = b2 + vec2<f32>(-b4.y, b4.x);
    yOut[4] = b1 + vec2<f32>(-b3.y, b3.x);
    return;
  }
  let a1 = mul(readStage(windowIndex, k + butterflyCount), getFftTwiddle(k));
  let a2 = mul(readStage(windowIndex, k + 2u * butterflyCount),
    getFftTwiddle(2u * k));
  let a3 = mul(readStage(windowIndex, k + 3u * butterflyCount),
    getFftTwiddle(3u * k));
  let a4 = mul(readStage(windowIndex, k + 4u * butterflyCount),
    getFftTwiddle(4u * k));
  let a5 = mul(readStage(windowIndex, k + 5u * butterflyCount),
    getFftTwiddle(5u * k));
  let a6 = mul(readStage(windowIndex, k + 6u * butterflyCount),
    getFftTwiddle(6u * k));
  let a7 = mul(readStage(windowIndex, k + 7u * butterflyCount),
    getFftTwiddle(7u * k));
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
  yOut[0] = E0 + p0;
  yOut[1] = E1 + p1;
  yOut[2] = E2 + p2;
  yOut[3] = E3 + p3;
  yOut[4] = E0 - p0;
  yOut[5] = E1 - p1;
  yOut[6] = E2 - p2;
  yOut[7] = E3 - p3;
}

fn runFusedLastStage(windowIndex: u32, k: u32) {
  let spectrumOffset = complexStride() * windowIndex;
  computeLastButterfly(windowIndex, k);
  var ya = yOut;
  if (k == 0u) {
    writeBin(spectrumOffset, 0u, vec2<f32>(ya[0].x + ya[0].y, 0.0));
    writeBin(
      spectrumOffset,
      packedWindowSize,
      vec2<f32>(ya[0].x - ya[0].y, 0.0),
    );
    for (var m = 1u; m < factor; m++) {
      let i = m * stageStride;
      writeBin(spectrumOffset, i, r2cBin(i, ya[m], ya[factor - m]));
    }
    return;
  }
  computeLastButterfly(windowIndex, stageStride - k);
  var yb = yOut;
  for (var m = 0u; m < factor; m++) {
    let i = k + m * stageStride;
    let mirrorValue = yb[factor - 1u - m];
    writeBin(spectrumOffset, i, r2cBin(i, ya[m], mirrorValue));
    writeBin(
      spectrumOffset,
      packedWindowSize - i,
      r2cBin(packedWindowSize - i, mirrorValue, ya[m]),
    );
  }
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

  let butterflyCount = packedWindowSize / factor;
  let j = workgroupId.y * threadCount + localId.x;

  if (fuseR2cPack == 1u) {
    if (2u * j > stageStride) {
      return;
    }
    runFusedLastStage(windowIndex, j);
    return;
  }

  if (j >= butterflyCount) {
    return;
  }

  let k = j % stageStride;
  let block = j / stageStride;
  let twiddleScale = packedWindowSize / (stageStride * factor);
  let scratchOffset = packedWindowSize * windowIndex;

  if (factor == 8u) {
    let base = block * stageStride + k;
    let tw = k * twiddleScale;
    let a0 = readStage(windowIndex, base);
    let a1 = mul(readStage(windowIndex, base + butterflyCount),
      getFftTwiddle(tw));
    let a2 = mul(readStage(windowIndex, base + 2u * butterflyCount),
      getFftTwiddle(2u * tw));
    let a3 = mul(readStage(windowIndex, base + 3u * butterflyCount),
      getFftTwiddle(3u * tw));
    let a4 = mul(readStage(windowIndex, base + 4u * butterflyCount),
      getFftTwiddle(4u * tw));
    let a5 = mul(readStage(windowIndex, base + 5u * butterflyCount),
      getFftTwiddle(5u * tw));
    let a6 = mul(readStage(windowIndex, base + 6u * butterflyCount),
      getFftTwiddle(6u * tw));
    let a7 = mul(readStage(windowIndex, base + 7u * butterflyCount),
      getFftTwiddle(7u * tw));
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
    let o0 = block * (stageStride * 8u) + k;
    let o1 = o0 + stageStride;
    let o2 = o1 + stageStride;
    let o3 = o2 + stageStride;
    let o4 = o3 + stageStride;
    let o5 = o4 + stageStride;
    let o6 = o5 + stageStride;
    let o7 = o6 + stageStride;
    writeScratch(scratchOffset + o0, E0 + p0);
    writeScratch(scratchOffset + o1, E1 + p1);
    writeScratch(scratchOffset + o2, E2 + p2);
    writeScratch(scratchOffset + o3, E3 + p3);
    writeScratch(scratchOffset + o4, E0 - p0);
    writeScratch(scratchOffset + o5, E1 - p1);
    writeScratch(scratchOffset + o6, E2 - p2);
    writeScratch(scratchOffset + o7, E3 - p3);
  } else if (factor == 2u) {
    let aIndex = block * stageStride + k;
    let bIndex = aIndex + butterflyCount;
    let a = readStage(windowIndex, aIndex);
    let b = mul(
      readStage(windowIndex, bIndex),
      getFftTwiddle(k * twiddleScale),
    );
    let outEven = block * (stageStride * 2u) + k;
    let outOdd = outEven + stageStride;
    writeScratch(scratchOffset + outEven, a + b);
    writeScratch(scratchOffset + outOdd, a - b);
  } else if (factor == 4u) {
    let r0 = block * stageStride + k;
    let r1 = r0 + butterflyCount;
    let r2 = r1 + butterflyCount;
    let r3 = r2 + butterflyCount;
    let a0 = readStage(windowIndex, r0);
    let a1 = mul(
      readStage(windowIndex, r1),
      getFftTwiddle(k * twiddleScale),
    );
    let a2 = mul(
      readStage(windowIndex, r2),
      getFftTwiddle(2u * k * twiddleScale),
    );
    let a3 = mul(
      readStage(windowIndex, r3),
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
    writeScratch(scratchOffset + i0, sum02 + sum13);
    writeScratch(scratchOffset + i1, diff02 + minusIDiff13);
    writeScratch(scratchOffset + i2, sum02 - sum13);
    writeScratch(scratchOffset + i3, diff02 + plusIDiff13);
  } else if (factor == 3u) {
    let base = block * stageStride + k;
    let tw = k * twiddleScale;
    let a0 = readStage(windowIndex, base);
    let a1 = mul(readStage(windowIndex, base + butterflyCount),
      getFftTwiddle(tw));
    let a2 = mul(readStage(windowIndex, base + 2u * butterflyCount),
      getFftTwiddle(2u * tw));
    let t1 = a1 + a2;
    let m = a0 - 0.5 * t1;
    let d = a2 - a1;
    let ids = vec2<f32>(-sin3 * d.y, sin3 * d.x);
    let o0 = block * (stageStride * 3u) + k;
    writeScratch(scratchOffset + o0, a0 + t1);
    writeScratch(scratchOffset + o0 + stageStride, m + ids);
    writeScratch(scratchOffset + o0 + 2u * stageStride, m - ids);
  } else if (factor == 5u) {
    let base = block * stageStride + k;
    let tw = k * twiddleScale;
    let a0 = readStage(windowIndex, base);
    let a1 = mul(readStage(windowIndex, base + butterflyCount),
      getFftTwiddle(tw));
    let a2 = mul(readStage(windowIndex, base + 2u * butterflyCount),
      getFftTwiddle(2u * tw));
    let a3 = mul(readStage(windowIndex, base + 3u * butterflyCount),
      getFftTwiddle(3u * tw));
    let a4 = mul(readStage(windowIndex, base + 4u * butterflyCount),
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
    writeScratch(scratchOffset + o0, a0 + t1 + t2);
    writeScratch(scratchOffset + o1, b1 + vec2<f32>(b3.y, -b3.x));
    writeScratch(scratchOffset + o2, b2 + vec2<f32>(b4.y, -b4.x));
    writeScratch(scratchOffset + o3, b2 + vec2<f32>(-b4.y, b4.x));
    writeScratch(scratchOffset + o4, b1 + vec2<f32>(-b3.y, b3.x));
  } else {
    for (var r = 0u; r < factor; r++) {
      var sum = vec2<f32>(0.0, 0.0);
      for (var q = 0u; q < factor; q++) {
        let inputIndex = block * stageStride + k + q * butterflyCount;
        let twiddleIndex =
          (q * (k * twiddleScale + r * (packedWindowSize / factor))) %
          packedWindowSize;
        var value = readStage(windowIndex, inputIndex);
        value = mul(value, getFftTwiddle(twiddleIndex));
        sum += value;
      }
      let outputIndex = block * (stageStride * factor) + r * stageStride + k;
      writeScratch(scratchOffset + outputIndex, sum);
    }
  }
}
`;
