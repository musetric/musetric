// Fused pair of inverse Stockham DIT radix stages (see the forward
// multiPassPairStageShader for the group structure). The first kernel can
// additionally fuse the C2R prepack read.
export const multiPassPairStageShader = `
override packedWindowSize: u32 = 8192u;
override factor1: u32 = 8u;
override factor2: u32 = 8u;
override stageStride: u32 = 1u;
override readFromPrepack: u32 = 0u;
override writeToSignal: u32 = 0u;
override readBufferIndex: u32 = 0u;
override writeBufferIndex: u32 = 0u;
override inPlace: u32 = 1u;

override threadCount: u32 = 64u;
const threadsPerGroup: u32 = 8u;
override groupsPerWorkgroup: u32 = 8u;
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

override pairSharedSize: u32 = 512u;

var<workgroup> sh: array<vec2<f32>, pairSharedSize>;

@group(0) @binding(0) var<storage, read_write> scratch0: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read_write> scratch1: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> fftTrigTable: array<f32>;
@group(0) @binding(3) var<uniform> params: Params;
@group(0) @binding(4) var<storage, read> sourceSpectrum: array<f32>;
@group(0) @binding(5) var<storage, read_write> signal: array<f32>;
@group(0) @binding(6) var<storage, read> r2cTrigTable: array<f32>;

var<private> windowSpectrumOffset: u32;
var<private> windowScratchOffset: u32;
var<private> windowSignalOffset: u32;
var<private> xv: array<vec2<f32>, 8>;
var<private> yv: array<vec2<f32>, 8>;

fn mul(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

// Conjugate twiddle (+sin) turns the forward DIT butterfly into the inverse.
fn getInvTwiddle(index: u32) -> vec2<f32> {
  return vec2<f32>(fftTrigTable[2u * index], fftTrigTable[2u * index + 1u]);
}

fn readSpectrumFloat(index: u32) -> f32 {
  if (inPlace == 1u) {
    return signal[windowSpectrumOffset + index];
  }
  return sourceSpectrum[windowSpectrumOffset + index];
}

fn readSpectrumBin(k: u32) -> vec2<f32> {
  let index = 2u * k;
  return vec2<f32>(readSpectrumFloat(index), readSpectrumFloat(index + 1u));
}

// C2R combine: fold the half-spectrum bin k and its mirror (N-k) into the
// packed complex sample feeding the size-(N/2) inverse FFT.
fn loadPackedSpectrum(k: u32) -> vec2<f32> {
  if (k == 0u) {
    let dc = readSpectrumFloat(0u);
    let nyquist = readSpectrumFloat(2u * packedWindowSize);
    return vec2<f32>(0.5 * (dc + nyquist), 0.5 * (dc - nyquist));
  }

  let mirrorK = packedWindowSize - k;
  let a = readSpectrumBin(k);
  let mirror = readSpectrumBin(mirrorK);
  let b = vec2<f32>(mirror.x, -mirror.y);
  let even = 0.5 * (a + b);
  let diff = 0.5 * (a - b);
  let invTwiddle = vec2<f32>(r2cTrigTable[2u * k], r2cTrigTable[2u * k + 1u]);
  let odd = mul(diff, invTwiddle);
  return even + vec2<f32>(-odd.y, odd.x);
}

fn readStage(windowIndex: u32, index: u32) -> vec2<f32> {
  if (readFromPrepack == 1u) {
    return loadPackedSpectrum(index);
  }
  if (readBufferIndex == 0u) {
    return scratch0[packedWindowSize * windowIndex + index];
  }
  return scratch1[packedWindowSize * windowIndex + index];
}

fn writeScratch(index: u32, value: vec2<f32>) {
  if (writeToSignal == 1u) {
    let localIndex = index - windowScratchOffset;
    let scaled = value * (1.0 / f32(packedWindowSize));
    signal[windowSignalOffset + 2u * localIndex] = scaled.x;
    signal[windowSignalOffset + 2u * localIndex + 1u] = scaled.y;
    return;
  }
  if (writeBufferIndex == 0u) {
    scratch0[index] = value;
  } else {
    scratch1[index] = value;
  }
}

// Inverse DFT of size f (2, 4 or 8) from xv into yv (conjugate rotations).
fn runDft(f: u32) {
  if (f == 8u) {
    let e0 = xv[0] + xv[4];
    let e1 = xv[0] - xv[4];
    let e2 = xv[2] + xv[6];
    let e3 = xv[2] - xv[6];
    let E0 = e0 + e2;
    let E1 = e1 + vec2<f32>(-e3.y, e3.x);
    let E2 = e0 - e2;
    let E3 = e1 + vec2<f32>(e3.y, -e3.x);
    let f0 = xv[1] + xv[5];
    let f1 = xv[1] - xv[5];
    let f2 = xv[3] + xv[7];
    let f3 = xv[3] - xv[7];
    let O0 = f0 + f2;
    let O1 = f1 + vec2<f32>(-f3.y, f3.x);
    let O2 = f0 - f2;
    let O3 = f1 + vec2<f32>(f3.y, -f3.x);
    let p0 = O0;
    let p1 = vec2<f32>(sqrt1_2 * (O1.x - O1.y), sqrt1_2 * (O1.x + O1.y));
    let p2 = vec2<f32>(-O2.y, O2.x);
    let p3 = vec2<f32>(-sqrt1_2 * (O3.x + O3.y), sqrt1_2 * (O3.x - O3.y));
    yv[0] = E0 + p0;
    yv[1] = E1 + p1;
    yv[2] = E2 + p2;
    yv[3] = E3 + p3;
    yv[4] = E0 - p0;
    yv[5] = E1 - p1;
    yv[6] = E2 - p2;
    yv[7] = E3 - p3;
    return;
  }
  if (f == 4u) {
    let sum02 = xv[0] + xv[2];
    let diff02 = xv[0] - xv[2];
    let sum13 = xv[1] + xv[3];
    let diff13 = xv[1] - xv[3];
    yv[0] = sum02 + sum13;
    yv[1] = diff02 + vec2<f32>(-diff13.y, diff13.x);
    yv[2] = sum02 - sum13;
    yv[3] = diff02 + vec2<f32>(diff13.y, -diff13.x);
    return;
  }
  if (f == 5u) {
    let t1 = xv[1] + xv[4];
    let t2 = xv[2] + xv[3];
    let t3 = xv[1] - xv[4];
    let t4 = xv[2] - xv[3];
    let b1 = xv[0] + cos5a * t1 + cos5b * t2;
    let b2 = xv[0] + cos5b * t1 + cos5a * t2;
    let b3 = sin5a * t3 + sin5b * t4;
    let b4 = sin5b * t3 - sin5a * t4;
    yv[0] = xv[0] + t1 + t2;
    yv[1] = b1 + vec2<f32>(-b3.y, b3.x);
    yv[2] = b2 + vec2<f32>(-b4.y, b4.x);
    yv[3] = b2 + vec2<f32>(b4.y, -b4.x);
    yv[4] = b1 + vec2<f32>(b3.y, -b3.x);
    return;
  }
  if (f == 3u) {
    let t1 = xv[1] + xv[2];
    let m = xv[0] - 0.5 * t1;
    let d = xv[2] - xv[1];
    let ids = vec2<f32>(sin3 * d.y, -sin3 * d.x);
    yv[0] = xv[0] + t1;
    yv[1] = m + ids;
    yv[2] = m - ids;
    return;
  }
  yv[0] = xv[0] + xv[1];
  yv[1] = xv[0] - xv[1];
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
  let groupLocal = t % groupsPerWorkgroup;
  let role = t / groupsPerWorkgroup;
  let group = workgroupId.y * groupsPerWorkgroup + groupLocal;
  let groupSize = factor1 * factor2;
  let groupCount = packedWindowSize / groupSize;
  let groupInRange = group < groupCount;

  let kA = group % stageStride;
  let blockB = group / stageStride;
  let strideB = stageStride * factor1;
  let twiddleScaleA = packedWindowSize / (stageStride * factor1);
  let twiddleScaleB = packedWindowSize / (strideB * factor2);
  let scratchOffset = packedWindowSize * windowIndex;
  let shBase = groupLocal * groupSize;
  windowSpectrumOffset = (params.windowSize + 2u) * windowIndex;
  windowScratchOffset = scratchOffset;
  windowSignalOffset = params.windowSize * windowIndex;

  if (groupInRange && role < factor2) {
    let blockA = blockB + role * twiddleScaleB;
    let srcBase = blockA * stageStride + kA;
    let butterflyCountA = packedWindowSize / factor1;
    for (var q = 0u; q < factor1; q++) {
      xv[q] = mul(
        readStage(windowIndex, srcBase + q * butterflyCountA),
        getInvTwiddle(q * kA * twiddleScaleA),
      );
    }
    runDft(factor1);
    for (var r = 0u; r < factor1; r++) {
      sh[shBase + role * factor1 + r] = yv[r];
    }
  }
  workgroupBarrier();

  if (groupInRange && role < factor1) {
    let kB = role * stageStride + kA;
    for (var q = 0u; q < factor2; q++) {
      xv[q] = mul(
        sh[shBase + q * factor1 + role],
        getInvTwiddle(q * kB * twiddleScaleB),
      );
    }
    runDft(factor2);
    let outBase = scratchOffset + blockB * (strideB * factor2) + kB;
    for (var r = 0u; r < factor2; r++) {
      writeScratch(outBase + r * strideB, yv[r]);
    }
  }
}
`;
