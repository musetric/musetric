export const multiPassStageShader = `
override packedWindowSize: u32 = 2560u;
override factor: u32 = 5u;
override stageStride: u32 = 1u;
override readBufferIndex: u32 = 1u;
override writeBufferIndex: u32 = 0u;

const threadCount: u32 = 64u;
const sin3: f32 = 0.86602540378443864676;
const cos5a: f32 = 0.30901699437494742410;
const cos5b: f32 = -0.80901699437494742410;
const sin5a: f32 = 0.95105651629515357212;
const sin5b: f32 = 0.58778525229247312917;

struct Params {
  windowSize: u32,
  windowCount: u32,
};

@group(0) @binding(0) var<storage, read_write> scratch0: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read_write> scratch1: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> fftTrigTable: array<f32>;
@group(0) @binding(3) var<uniform> params: Params;

fn mul(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

// Conjugate twiddle (+sin) turns the forward DIT butterfly into the inverse.
fn getInvTwiddle(index: u32) -> vec2<f32> {
  return vec2<f32>(fftTrigTable[2u * index], fftTrigTable[2u * index + 1u]);
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

@compute @workgroup_size(threadCount)
fn main(
  @builtin(workgroup_id) workgroupId: vec3<u32>,
  @builtin(local_invocation_id) localId: vec3<u32>,
) {
  let windowIndex = workgroupId.x;
  if (windowIndex >= params.windowCount) {
    return;
  }

  let butterflyCount = packedWindowSize / factor;
  let j = workgroupId.y * threadCount + localId.x;
  if (j >= butterflyCount) {
    return;
  }

  let k = j % stageStride;
  let block = j / stageStride;
  let twiddleScale = packedWindowSize / (stageStride * factor);
  let scratchOffset = packedWindowSize * windowIndex;

  if (factor == 2u) {
    let aIndex = block * stageStride + k;
    let bIndex = aIndex + butterflyCount;
    let a = readScratch(scratchOffset + aIndex);
    let b = mul(
      readScratch(scratchOffset + bIndex),
      getInvTwiddle(k * twiddleScale),
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
    let a0 = readScratch(scratchOffset + r0);
    let a1 = mul(readScratch(scratchOffset + r1), getInvTwiddle(k * twiddleScale));
    let a2 = mul(
      readScratch(scratchOffset + r2),
      getInvTwiddle(2u * k * twiddleScale),
    );
    let a3 = mul(
      readScratch(scratchOffset + r3),
      getInvTwiddle(3u * k * twiddleScale),
    );
    let sum02 = a0 + a2;
    let diff02 = a0 - a2;
    let sum13 = a1 + a3;
    let diff13 = a1 - a3;
    // inverse radix-4: +i and -i rotations swap relative to the forward.
    let plusIDiff13 = vec2<f32>(-diff13.y, diff13.x);
    let minusIDiff13 = vec2<f32>(diff13.y, -diff13.x);
    let i0 = block * (stageStride * 4u) + k;
    let i1 = i0 + stageStride;
    let i2 = i1 + stageStride;
    let i3 = i2 + stageStride;
    writeScratch(scratchOffset + i0, sum02 + sum13);
    writeScratch(scratchOffset + i1, diff02 + plusIDiff13);
    writeScratch(scratchOffset + i2, sum02 - sum13);
    writeScratch(scratchOffset + i3, diff02 + minusIDiff13);
  } else if (factor == 3u) {
    let base = block * stageStride + k;
    let tw = k * twiddleScale;
    let a0 = readScratch(scratchOffset + base);
    let a1 = mul(readScratch(scratchOffset + base + butterflyCount),
      getInvTwiddle(tw));
    let a2 = mul(readScratch(scratchOffset + base + 2u * butterflyCount),
      getInvTwiddle(2u * tw));
    let t1 = a1 + a2;
    let m = a0 - 0.5 * t1;
    let d = a2 - a1;
    // inverse radix-3: i-rotation sign flipped vs the forward.
    let ids = vec2<f32>(sin3 * d.y, -sin3 * d.x);
    let o0 = block * (stageStride * 3u) + k;
    writeScratch(scratchOffset + o0, a0 + t1);
    writeScratch(scratchOffset + o0 + stageStride, m + ids);
    writeScratch(scratchOffset + o0 + 2u * stageStride, m - ids);
  } else if (factor == 5u) {
    let base = block * stageStride + k;
    let tw = k * twiddleScale;
    let a0 = readScratch(scratchOffset + base);
    let a1 = mul(readScratch(scratchOffset + base + butterflyCount),
      getInvTwiddle(tw));
    let a2 = mul(readScratch(scratchOffset + base + 2u * butterflyCount),
      getInvTwiddle(2u * tw));
    let a3 = mul(readScratch(scratchOffset + base + 3u * butterflyCount),
      getInvTwiddle(3u * tw));
    let a4 = mul(readScratch(scratchOffset + base + 4u * butterflyCount),
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
    // inverse radix-5: i-rotation signs flipped vs the forward.
    writeScratch(scratchOffset + o0, a0 + t1 + t2);
    writeScratch(scratchOffset + o1, b1 + vec2<f32>(-b3.y, b3.x));
    writeScratch(scratchOffset + o2, b2 + vec2<f32>(-b4.y, b4.x));
    writeScratch(scratchOffset + o3, b2 + vec2<f32>(b4.y, -b4.x));
    writeScratch(scratchOffset + o4, b1 + vec2<f32>(b3.y, -b3.x));
  } else {
    for (var r = 0u; r < factor; r++) {
      var sum = vec2<f32>(0.0, 0.0);
      for (var q = 0u; q < factor; q++) {
        let inputIndex = block * stageStride + k + q * butterflyCount;
        let twiddleIndex =
          (q * (k * twiddleScale + r * (packedWindowSize / factor))) %
          packedWindowSize;
        var value = readScratch(scratchOffset + inputIndex);
        value = mul(value, getInvTwiddle(twiddleIndex));
        sum += value;
      }
      let outputIndex = block * (stageStride * factor) + r * stageStride + k;
      writeScratch(scratchOffset + outputIndex, sum);
    }
  }
}
`;
