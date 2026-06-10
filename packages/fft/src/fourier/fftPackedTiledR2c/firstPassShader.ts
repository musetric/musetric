export const firstPassShader = `
override packedWindowSize: u32 = 4096u;
override tileSize: u32 = 64u;
override rowSize: u32 = 64u;
override columnSize: u32 = 64u;
override rowRadix8StageCount: u32 = 2u;
override rowRadix4StageCount: u32 = 0u;
override rowRadix2StageCount: u32 = 0u;
override inPlace: u32 = 1u;

const threadCount: u32 = 64u;
const batchSize: u32 = 4u;
const sqrt1_2: f32 = 0.70710678118654752440;

struct Params {
  windowSize: u32,
  windowCount: u32,
};

var<workgroup> smReal0: array<f32, batchSize * tileSize>;
var<workgroup> smImag0: array<f32, batchSize * tileSize>;
var<workgroup> smReal1: array<f32, batchSize * tileSize>;
var<workgroup> smImag1: array<f32, batchSize * tileSize>;

@group(0) @binding(0) var<storage, read> wave: array<f32>;
@group(0) @binding(1) var<storage, read> spectrum: array<f32>;
@group(0) @binding(2) var<storage, read_write> scratch: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read> rowTrigTable: array<f32>;
@group(0) @binding(4) var<storage, read> fourStepTrigTable: array<f32>;
@group(0) @binding(5) var<uniform> params: Params;

fn smIndex(lane: u32, index: u32) -> u32 {
  return lane * tileSize + index;
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

fn mul(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(
    a.x * b.x - a.y * b.y,
    a.x * b.y + a.y * b.x,
  );
}

fn rowFactorCount() -> u32 {
  return rowRadix8StageCount + rowRadix4StageCount + rowRadix2StageCount;
}

fn rowFactor(stage: u32) -> u32 {
  if (stage < rowRadix8StageCount) {
    return 8u;
  }
  if (stage < rowRadix8StageCount + rowRadix4StageCount) {
    return 4u;
  }
  return 2u;
}

fn getRowTwiddle(index: u32) -> vec2<f32> {
  return vec2<f32>(rowTrigTable[2u * index], -rowTrigTable[2u * index + 1u]);
}

fn readRow(lane: u32, index: u32, readEven: bool) -> vec2<f32> {
  if (readEven) {
    return vec2<f32>(smReal0[smIndex(lane, index)], smImag0[smIndex(lane, index)]);
  }
  return vec2<f32>(smReal1[smIndex(lane, index)], smImag1[smIndex(lane, index)]);
}

fn writeRow(lane: u32, index: u32, readEven: bool, value: vec2<f32>) {
  if (readEven) {
    smReal1[smIndex(lane, index)] = value.x;
    smImag1[smIndex(lane, index)] = value.y;
  } else {
    smReal0[smIndex(lane, index)] = value.x;
    smImag0[smIndex(lane, index)] = value.y;
  }
}

// Small tiles run the original tight scalar radix-2 loops; the generic mixed
// helpers measurably regress them (~20-30%).
fn runRowFftRadix2(t: u32, lane: u32) {
  let rowHalfSize = rowSize / 2u;
  for (var stage: u32 = 0u; stage < rowRadix2StageCount; stage++) {
    let stride = 1u << stage;
    let evenStage = (stage & 1u) == 0u;

    for (var j = t; j < rowHalfSize; j += threadCount) {
      let k = j % stride;
      let block = j / stride;
      let aIndex = block * stride + k;
      let bIndex = aIndex + rowHalfSize;
      let outEven = block * (stride << 1u) + k;
      let outOdd = outEven + stride;
      let trigIndex = k * (rowHalfSize / stride);
      let twiddleReal = rowTrigTable[2u * trigIndex];
      let twiddleImag = -rowTrigTable[2u * trigIndex + 1u];

      var aReal: f32;
      var aImag: f32;
      var bReal: f32;
      var bImag: f32;
      if (evenStage) {
        aReal = smReal0[smIndex(lane, aIndex)];
        aImag = smImag0[smIndex(lane, aIndex)];
        bReal = smReal0[smIndex(lane, bIndex)];
        bImag = smImag0[smIndex(lane, bIndex)];
      } else {
        aReal = smReal1[smIndex(lane, aIndex)];
        aImag = smImag1[smIndex(lane, aIndex)];
        bReal = smReal1[smIndex(lane, bIndex)];
        bImag = smImag1[smIndex(lane, bIndex)];
      }

      let productReal = bReal * twiddleReal - bImag * twiddleImag;
      let productImag = bReal * twiddleImag + bImag * twiddleReal;

      if (evenStage) {
        smReal1[smIndex(lane, outEven)] = aReal + productReal;
        smImag1[smIndex(lane, outEven)] = aImag + productImag;
        smReal1[smIndex(lane, outOdd)] = aReal - productReal;
        smImag1[smIndex(lane, outOdd)] = aImag - productImag;
      } else {
        smReal0[smIndex(lane, outEven)] = aReal + productReal;
        smImag0[smIndex(lane, outEven)] = aImag + productImag;
        smReal0[smIndex(lane, outOdd)] = aReal - productReal;
        smImag0[smIndex(lane, outOdd)] = aImag - productImag;
      }
    }
    workgroupBarrier();
  }
}

fn runRowFft(t: u32, lane: u32) {
  if (rowRadix8StageCount == 0u && rowRadix4StageCount == 0u) {
    runRowFftRadix2(t, lane);
    return;
  }
  var stride = 1u;
  for (var stage: u32 = 0u; stage < rowFactorCount(); stage++) {
    let factor = rowFactor(stage);
    let readEven = (stage & 1u) == 0u;
    let butterflyCount = rowSize / factor;
    let twiddleScale = rowSize / (stride * factor);

    if (factor == 8u) {
      for (var j = t; j < butterflyCount; j += threadCount) {
        let k = j % stride;
        let block = j / stride;
        let base = block * stride + k;
        let tw = k * twiddleScale;
        let a0 = readRow(lane, base, readEven);
        let a1 = mul(readRow(lane, base + butterflyCount, readEven),
          getRowTwiddle(tw));
        let a2 = mul(readRow(lane, base + 2u * butterflyCount, readEven),
          getRowTwiddle(2u * tw));
        let a3 = mul(readRow(lane, base + 3u * butterflyCount, readEven),
          getRowTwiddle(3u * tw));
        let a4 = mul(readRow(lane, base + 4u * butterflyCount, readEven),
          getRowTwiddle(4u * tw));
        let a5 = mul(readRow(lane, base + 5u * butterflyCount, readEven),
          getRowTwiddle(5u * tw));
        let a6 = mul(readRow(lane, base + 6u * butterflyCount, readEven),
          getRowTwiddle(6u * tw));
        let a7 = mul(readRow(lane, base + 7u * butterflyCount, readEven),
          getRowTwiddle(7u * tw));
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
        let o0 = block * (stride * 8u) + k;
        let o1 = o0 + stride;
        let o2 = o1 + stride;
        let o3 = o2 + stride;
        let o4 = o3 + stride;
        let o5 = o4 + stride;
        let o6 = o5 + stride;
        let o7 = o6 + stride;
        writeRow(lane, o0, readEven, E0 + p0);
        writeRow(lane, o1, readEven, E1 + p1);
        writeRow(lane, o2, readEven, E2 + p2);
        writeRow(lane, o3, readEven, E3 + p3);
        writeRow(lane, o4, readEven, E0 - p0);
        writeRow(lane, o5, readEven, E1 - p1);
        writeRow(lane, o6, readEven, E2 - p2);
        writeRow(lane, o7, readEven, E3 - p3);
      }
    } else if (factor == 4u) {
      for (var j = t; j < butterflyCount; j += threadCount) {
        let k = j % stride;
        let block = j / stride;
        let base = block * stride + k;
        let tw = k * twiddleScale;
        let a0 = readRow(lane, base, readEven);
        let a1 = mul(readRow(lane, base + butterflyCount, readEven),
          getRowTwiddle(tw));
        let a2 = mul(readRow(lane, base + 2u * butterflyCount, readEven),
          getRowTwiddle(2u * tw));
        let a3 = mul(readRow(lane, base + 3u * butterflyCount, readEven),
          getRowTwiddle(3u * tw));
        let sum02 = a0 + a2;
        let diff02 = a0 - a2;
        let sum13 = a1 + a3;
        let diff13 = a1 - a3;
        let minusIDiff13 = vec2<f32>(diff13.y, -diff13.x);
        let plusIDiff13 = vec2<f32>(-diff13.y, diff13.x);
        let o0 = block * (stride * 4u) + k;
        let o1 = o0 + stride;
        let o2 = o1 + stride;
        let o3 = o2 + stride;
        writeRow(lane, o0, readEven, sum02 + sum13);
        writeRow(lane, o1, readEven, diff02 + minusIDiff13);
        writeRow(lane, o2, readEven, sum02 - sum13);
        writeRow(lane, o3, readEven, diff02 + plusIDiff13);
      }
    } else {
      for (var j = t; j < butterflyCount; j += threadCount) {
        let k = j % stride;
        let block = j / stride;
        let aIndex = block * stride + k;
        let a = readRow(lane, aIndex, readEven);
        let b = mul(
          readRow(lane, aIndex + butterflyCount, readEven),
          getRowTwiddle(k * twiddleScale),
        );
        let outEven = block * (stride * 2u) + k;
        writeRow(lane, outEven, readEven, a + b);
        writeRow(lane, outEven + stride, readEven, a - b);
      }
    }

    stride = stride * factor;
    workgroupBarrier();
  }
}

fn getRowResult(index: u32, lane: u32) -> vec2<f32> {
  if ((rowFactorCount() & 1u) == 0u) {
    return vec2<f32>(
      smReal0[smIndex(lane, index)],
      smImag0[smIndex(lane, index)],
    );
  }
  return vec2<f32>(
    smReal1[smIndex(lane, index)],
    smImag1[smIndex(lane, index)],
  );
}

@compute @workgroup_size(64, 4)
fn main(
  @builtin(workgroup_id) workgroupId: vec3<u32>,
  @builtin(local_invocation_id) localId: vec3<u32>,
) {
  let n1 = workgroupId.x * batchSize + localId.y;
  let windowIndex = workgroupId.y;
  if (windowIndex >= params.windowCount) {
    return;
  }

  let t = localId.x;
  let lane = localId.y;
  let inputOffset = getInputWindowOffset(windowIndex);

  for (var i = t; i < rowSize; i += threadCount) {
    if (n1 < columnSize) {
      let packedIndex = i * columnSize + n1;
      let sampleIndex = packedIndex * 2u;
      smReal0[smIndex(lane, i)] = readInput(inputOffset, sampleIndex);
      smImag0[smIndex(lane, i)] = readInput(inputOffset, sampleIndex + 1u);
    }
  }
  workgroupBarrier();

  runRowFft(t, lane);

  if (n1 >= columnSize) {
    return;
  }

  for (var i = t; i < rowSize; i += threadCount) {
    let twiddleIndex = i * columnSize + n1;
    let twiddleReal = fourStepTrigTable[2u * twiddleIndex];
    let twiddleImag = -fourStepTrigTable[2u * twiddleIndex + 1u];
    let result = getRowResult(i, lane);
    let productReal = result.x * twiddleReal - result.y * twiddleImag;
    let productImag = result.x * twiddleImag + result.y * twiddleReal;
    let scratchOffset = packedWindowSize * windowIndex;
    let scratchIndex = scratchOffset + i * columnSize + n1;

    scratch[scratchIndex] = vec2<f32>(productReal, productImag);
  }
}
`;
