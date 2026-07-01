// Fused pair of Stockham DIT radix stages: one kernel applies stage A
// (factor1 at stageStride) and stage B (factor2 at stageStride * factor1)
// through workgroup shared memory, halving the global-memory round trips.
// A group of factor1 * factor2 points is closed under both stages: the
// factor2 stage-A butterflies of a group produce exactly the inputs of its
// factor1 stage-B butterflies. Eight threads cooperate per group.
export const multiPassPairStageShader = `
override packedWindowSize: u32 = 8192u;
override factor1: u32 = 8u;
override factor2: u32 = 8u;
override stageStride: u32 = 1u;
override readFromInput: u32 = 1u;
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

@group(0) @binding(0) var<storage, read> wave: array<f32>;
@group(0) @binding(1) var<storage, read> spectrum: array<f32>;
@group(0) @binding(2) var<storage, read_write> scratch0: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read_write> scratch1: array<vec2<f32>>;
@group(0) @binding(4) var<storage, read> fftTrigTable: array<f32>;
@group(0) @binding(5) var<uniform> params: Params;

var<private> xv: array<vec2<f32>, 8>;
var<private> yv: array<vec2<f32>, 8>;

fn mul(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(
    a.x * b.x - a.y * b.y,
    a.x * b.y + a.y * b.x,
  );
}

fn getFftTwiddle(index: u32) -> vec2<f32> {
  return vec2<f32>(fftTrigTable[2u * index], -fftTrigTable[2u * index + 1u]);
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

  if (readBufferIndex == 0u) {
    return scratch0[packedWindowSize * windowIndex + index];
  }
  return scratch1[packedWindowSize * windowIndex + index];
}

fn writeScratch(index: u32, value: vec2<f32>) {
  if (writeBufferIndex == 0u) {
    scratch0[index] = value;
  } else {
    scratch1[index] = value;
  }
}

// Forward DFT of size f (2, 4 or 8) from xv into yv, bin order matching the
// single-stage Stockham codelets.
fn runDft(f: u32) {
  if (f == 8u) {
    let e0 = xv[0] + xv[4];
    let e1 = xv[0] - xv[4];
    let e2 = xv[2] + xv[6];
    let e3 = xv[2] - xv[6];
    let E0 = e0 + e2;
    let E1 = e1 + vec2<f32>(e3.y, -e3.x);
    let E2 = e0 - e2;
    let E3 = e1 + vec2<f32>(-e3.y, e3.x);
    let f0 = xv[1] + xv[5];
    let f1 = xv[1] - xv[5];
    let f2 = xv[3] + xv[7];
    let f3 = xv[3] - xv[7];
    let O0 = f0 + f2;
    let O1 = f1 + vec2<f32>(f3.y, -f3.x);
    let O2 = f0 - f2;
    let O3 = f1 + vec2<f32>(-f3.y, f3.x);
    let p0 = O0;
    let p1 = vec2<f32>(sqrt1_2 * (O1.x + O1.y), sqrt1_2 * (O1.y - O1.x));
    let p2 = vec2<f32>(O2.y, -O2.x);
    let p3 = vec2<f32>(sqrt1_2 * (O3.y - O3.x), -sqrt1_2 * (O3.x + O3.y));
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
    yv[1] = diff02 + vec2<f32>(diff13.y, -diff13.x);
    yv[2] = sum02 - sum13;
    yv[3] = diff02 + vec2<f32>(-diff13.y, diff13.x);
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
    yv[1] = b1 + vec2<f32>(b3.y, -b3.x);
    yv[2] = b2 + vec2<f32>(b4.y, -b4.x);
    yv[3] = b2 + vec2<f32>(-b4.y, b4.x);
    yv[4] = b1 + vec2<f32>(-b3.y, b3.x);
    return;
  }
  if (f == 3u) {
    let t1 = xv[1] + xv[2];
    let m = xv[0] - 0.5 * t1;
    let d = xv[2] - xv[1];
    let ids = vec2<f32>(-sin3 * d.y, sin3 * d.x);
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
  // Consecutive threads take consecutive groups so global reads and writes
  // stay coalesced; the cooperating role index moves slowly.
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

  // Stage A: role = q2 picks one of the factor2 stage-A butterflies.
  if (groupInRange && role < factor2) {
    let blockA = blockB + role * twiddleScaleB;
    let srcBase = blockA * stageStride + kA;
    let butterflyCountA = packedWindowSize / factor1;
    for (var q = 0u; q < factor1; q++) {
      xv[q] = mul(
        readStage(windowIndex, srcBase + q * butterflyCountA),
        getFftTwiddle(q * kA * twiddleScaleA),
      );
    }
    runDft(factor1);
    for (var r = 0u; r < factor1; r++) {
      sh[shBase + role * factor1 + r] = yv[r];
    }
  }
  workgroupBarrier();

  // Stage B: role = r picks one of the factor1 stage-B butterflies.
  if (groupInRange && role < factor1) {
    let kB = role * stageStride + kA;
    for (var q = 0u; q < factor2; q++) {
      xv[q] = mul(
        sh[shBase + q * factor1 + role],
        getFftTwiddle(q * kB * twiddleScaleB),
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
