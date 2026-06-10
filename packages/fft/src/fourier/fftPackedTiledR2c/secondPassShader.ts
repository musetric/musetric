export const secondPassShader = `
override packedWindowSize: u32 = 4096u;
override positiveWindowSize: u32 = 4096u;
override tileSize: u32 = 64u;
override rowSize: u32 = 64u;
override rowHalfSize: u32 = 32u;
override rowPairCount: u32 = 33u;
override columnSize: u32 = 64u;
override columnRadix8StageCount: u32 = 2u;
override columnRadix4StageCount: u32 = 0u;
override columnRadix2StageCount: u32 = 0u;

const threadCount: u32 = 64u;
const batchSize: u32 = 4u;
const sqrt1_2: f32 = 0.70710678118654752440;

struct Params {
  windowSize: u32,
  windowCount: u32,
};

var<workgroup> rowAReal0: array<f32, batchSize * tileSize>;
var<workgroup> rowAImag0: array<f32, batchSize * tileSize>;
var<workgroup> rowAReal1: array<f32, batchSize * tileSize>;
var<workgroup> rowAImag1: array<f32, batchSize * tileSize>;
var<workgroup> rowBReal0: array<f32, batchSize * tileSize>;
var<workgroup> rowBImag0: array<f32, batchSize * tileSize>;
var<workgroup> rowBReal1: array<f32, batchSize * tileSize>;
var<workgroup> rowBImag1: array<f32, batchSize * tileSize>;

@group(0) @binding(0) var<storage, read> scratch: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read_write> spectrum: array<f32>;
@group(0) @binding(2) var<storage, read> columnTrigTable: array<f32>;
@group(0) @binding(3) var<storage, read> r2cTrigTable: array<f32>;
@group(0) @binding(4) var<uniform> params: Params;

fn smIndex(lane: u32, index: u32) -> u32 {
  return lane * tileSize + index;
}

fn mul(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(
    a.x * b.x - a.y * b.y,
    a.x * b.y + a.y * b.x,
  );
}

fn columnFactorCount() -> u32 {
  return columnRadix8StageCount + columnRadix4StageCount +
    columnRadix2StageCount;
}

fn columnFactor(stage: u32) -> u32 {
  if (stage < columnRadix8StageCount) {
    return 8u;
  }
  if (stage < columnRadix8StageCount + columnRadix4StageCount) {
    return 4u;
  }
  return 2u;
}

fn getColTwiddle(index: u32) -> vec2<f32> {
  return vec2<f32>(
    columnTrigTable[2u * index],
    -columnTrigTable[2u * index + 1u],
  );
}

fn readColA(lane: u32, index: u32, readEven: bool) -> vec2<f32> {
  if (readEven) {
    return vec2<f32>(
      rowAReal0[smIndex(lane, index)],
      rowAImag0[smIndex(lane, index)],
    );
  }
  return vec2<f32>(
    rowAReal1[smIndex(lane, index)],
    rowAImag1[smIndex(lane, index)],
  );
}

fn writeColA(lane: u32, index: u32, readEven: bool, value: vec2<f32>) {
  if (readEven) {
    rowAReal1[smIndex(lane, index)] = value.x;
    rowAImag1[smIndex(lane, index)] = value.y;
  } else {
    rowAReal0[smIndex(lane, index)] = value.x;
    rowAImag0[smIndex(lane, index)] = value.y;
  }
}

fn readColB(lane: u32, index: u32, readEven: bool) -> vec2<f32> {
  if (readEven) {
    return vec2<f32>(
      rowBReal0[smIndex(lane, index)],
      rowBImag0[smIndex(lane, index)],
    );
  }
  return vec2<f32>(
    rowBReal1[smIndex(lane, index)],
    rowBImag1[smIndex(lane, index)],
  );
}

fn writeColB(lane: u32, index: u32, readEven: bool, value: vec2<f32>) {
  if (readEven) {
    rowBReal1[smIndex(lane, index)] = value.x;
    rowBImag1[smIndex(lane, index)] = value.y;
  } else {
    rowBReal0[smIndex(lane, index)] = value.x;
    rowBImag0[smIndex(lane, index)] = value.y;
  }
}

// Small tiles run the original tight scalar radix-2 loops; the generic mixed
// helpers measurably regress them (~20-30%).
fn runColumnFftPairRadix2(t: u32, lane: u32) {
  let columnHalfSize = columnSize / 2u;
  for (var stage: u32 = 0u; stage < columnRadix2StageCount; stage++) {
    let stride = 1u << stage;
    let evenStage = (stage & 1u) == 0u;

    for (var j = t; j < columnHalfSize; j += threadCount) {
      let k = j % stride;
      let block = j / stride;
      let aIndex = block * stride + k;
      let bIndex = aIndex + columnHalfSize;
      let outEven = block * (stride << 1u) + k;
      let outOdd = outEven + stride;
      let trigIndex = k * (columnHalfSize / stride);
      let twiddleReal = columnTrigTable[2u * trigIndex];
      let twiddleImag = -columnTrigTable[2u * trigIndex + 1u];

      var aReal: f32;
      var aImag: f32;
      var bReal: f32;
      var bImag: f32;
      var rowBAr: f32;
      var rowBAi: f32;
      var rowBBr: f32;
      var rowBBi: f32;
      if (evenStage) {
        aReal = rowAReal0[smIndex(lane, aIndex)];
        aImag = rowAImag0[smIndex(lane, aIndex)];
        bReal = rowAReal0[smIndex(lane, bIndex)];
        bImag = rowAImag0[smIndex(lane, bIndex)];
        rowBAr = rowBReal0[smIndex(lane, aIndex)];
        rowBAi = rowBImag0[smIndex(lane, aIndex)];
        rowBBr = rowBReal0[smIndex(lane, bIndex)];
        rowBBi = rowBImag0[smIndex(lane, bIndex)];
      } else {
        aReal = rowAReal1[smIndex(lane, aIndex)];
        aImag = rowAImag1[smIndex(lane, aIndex)];
        bReal = rowAReal1[smIndex(lane, bIndex)];
        bImag = rowAImag1[smIndex(lane, bIndex)];
        rowBAr = rowBReal1[smIndex(lane, aIndex)];
        rowBAi = rowBImag1[smIndex(lane, aIndex)];
        rowBBr = rowBReal1[smIndex(lane, bIndex)];
        rowBBi = rowBImag1[smIndex(lane, bIndex)];
      }

      let productReal = bReal * twiddleReal - bImag * twiddleImag;
      let productImag = bReal * twiddleImag + bImag * twiddleReal;
      let rowBProductReal = rowBBr * twiddleReal - rowBBi * twiddleImag;
      let rowBProductImag = rowBBr * twiddleImag + rowBBi * twiddleReal;

      if (evenStage) {
        rowAReal1[smIndex(lane, outEven)] = aReal + productReal;
        rowAImag1[smIndex(lane, outEven)] = aImag + productImag;
        rowAReal1[smIndex(lane, outOdd)] = aReal - productReal;
        rowAImag1[smIndex(lane, outOdd)] = aImag - productImag;
        rowBReal1[smIndex(lane, outEven)] = rowBAr + rowBProductReal;
        rowBImag1[smIndex(lane, outEven)] = rowBAi + rowBProductImag;
        rowBReal1[smIndex(lane, outOdd)] = rowBAr - rowBProductReal;
        rowBImag1[smIndex(lane, outOdd)] = rowBAi - rowBProductImag;
      } else {
        rowAReal0[smIndex(lane, outEven)] = aReal + productReal;
        rowAImag0[smIndex(lane, outEven)] = aImag + productImag;
        rowAReal0[smIndex(lane, outOdd)] = aReal - productReal;
        rowAImag0[smIndex(lane, outOdd)] = aImag - productImag;
        rowBReal0[smIndex(lane, outEven)] = rowBAr + rowBProductReal;
        rowBImag0[smIndex(lane, outEven)] = rowBAi + rowBProductImag;
        rowBReal0[smIndex(lane, outOdd)] = rowBAr - rowBProductReal;
        rowBImag0[smIndex(lane, outOdd)] = rowBAi - rowBProductImag;
      }
    }
    workgroupBarrier();
  }
}

fn runColumnFftPair(t: u32, lane: u32) {
  if (columnRadix8StageCount == 0u && columnRadix4StageCount == 0u) {
    runColumnFftPairRadix2(t, lane);
    return;
  }
  var stride = 1u;
  for (var stage: u32 = 0u; stage < columnFactorCount(); stage++) {
    let factor = columnFactor(stage);
    let readEven = (stage & 1u) == 0u;
    let butterflyCount = columnSize / factor;
    let twiddleScale = columnSize / (stride * factor);

    if (factor == 8u) {
      for (var j = t; j < butterflyCount; j += threadCount) {
        let k = j % stride;
        let block = j / stride;
        let base = block * stride + k;
        let tw = k * twiddleScale;
        let w1 = getColTwiddle(tw);
        let w2 = getColTwiddle(2u * tw);
        let w3 = getColTwiddle(3u * tw);
        let w4 = getColTwiddle(4u * tw);
        let w5 = getColTwiddle(5u * tw);
        let w6 = getColTwiddle(6u * tw);
        let w7 = getColTwiddle(7u * tw);
        let o0 = block * (stride * 8u) + k;
        let o1 = o0 + stride;
        let o2 = o1 + stride;
        let o3 = o2 + stride;
        let o4 = o3 + stride;
        let o5 = o4 + stride;
        let o6 = o5 + stride;
        let o7 = o6 + stride;
        {
          let a0 = readColA(lane, base, readEven);
          let a1 = mul(readColA(lane, base + butterflyCount, readEven), w1);
          let a2 = mul(readColA(lane, base + 2u * butterflyCount, readEven), w2);
          let a3 = mul(readColA(lane, base + 3u * butterflyCount, readEven), w3);
          let a4 = mul(readColA(lane, base + 4u * butterflyCount, readEven), w4);
          let a5 = mul(readColA(lane, base + 5u * butterflyCount, readEven), w5);
          let a6 = mul(readColA(lane, base + 6u * butterflyCount, readEven), w6);
          let a7 = mul(readColA(lane, base + 7u * butterflyCount, readEven), w7);
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
          writeColA(lane, o0, readEven, E0 + p0);
          writeColA(lane, o1, readEven, E1 + p1);
          writeColA(lane, o2, readEven, E2 + p2);
          writeColA(lane, o3, readEven, E3 + p3);
          writeColA(lane, o4, readEven, E0 - p0);
          writeColA(lane, o5, readEven, E1 - p1);
          writeColA(lane, o6, readEven, E2 - p2);
          writeColA(lane, o7, readEven, E3 - p3);
        }
        {
          let a0 = readColB(lane, base, readEven);
          let a1 = mul(readColB(lane, base + butterflyCount, readEven), w1);
          let a2 = mul(readColB(lane, base + 2u * butterflyCount, readEven), w2);
          let a3 = mul(readColB(lane, base + 3u * butterflyCount, readEven), w3);
          let a4 = mul(readColB(lane, base + 4u * butterflyCount, readEven), w4);
          let a5 = mul(readColB(lane, base + 5u * butterflyCount, readEven), w5);
          let a6 = mul(readColB(lane, base + 6u * butterflyCount, readEven), w6);
          let a7 = mul(readColB(lane, base + 7u * butterflyCount, readEven), w7);
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
          writeColB(lane, o0, readEven, E0 + p0);
          writeColB(lane, o1, readEven, E1 + p1);
          writeColB(lane, o2, readEven, E2 + p2);
          writeColB(lane, o3, readEven, E3 + p3);
          writeColB(lane, o4, readEven, E0 - p0);
          writeColB(lane, o5, readEven, E1 - p1);
          writeColB(lane, o6, readEven, E2 - p2);
          writeColB(lane, o7, readEven, E3 - p3);
        }
      }
    } else if (factor == 4u) {
      for (var j = t; j < butterflyCount; j += threadCount) {
        let k = j % stride;
        let block = j / stride;
        let base = block * stride + k;
        let tw = k * twiddleScale;
        let w1 = getColTwiddle(tw);
        let w2 = getColTwiddle(2u * tw);
        let w3 = getColTwiddle(3u * tw);
        let o0 = block * (stride * 4u) + k;
        let o1 = o0 + stride;
        let o2 = o1 + stride;
        let o3 = o2 + stride;
        {
          let a0 = readColA(lane, base, readEven);
          let a1 = mul(readColA(lane, base + butterflyCount, readEven), w1);
          let a2 = mul(readColA(lane, base + 2u * butterflyCount, readEven), w2);
          let a3 = mul(readColA(lane, base + 3u * butterflyCount, readEven), w3);
          let sum02 = a0 + a2;
          let diff02 = a0 - a2;
          let sum13 = a1 + a3;
          let diff13 = a1 - a3;
          let minusIDiff13 = vec2<f32>(diff13.y, -diff13.x);
          let plusIDiff13 = vec2<f32>(-diff13.y, diff13.x);
          writeColA(lane, o0, readEven, sum02 + sum13);
          writeColA(lane, o1, readEven, diff02 + minusIDiff13);
          writeColA(lane, o2, readEven, sum02 - sum13);
          writeColA(lane, o3, readEven, diff02 + plusIDiff13);
        }
        {
          let a0 = readColB(lane, base, readEven);
          let a1 = mul(readColB(lane, base + butterflyCount, readEven), w1);
          let a2 = mul(readColB(lane, base + 2u * butterflyCount, readEven), w2);
          let a3 = mul(readColB(lane, base + 3u * butterflyCount, readEven), w3);
          let sum02 = a0 + a2;
          let diff02 = a0 - a2;
          let sum13 = a1 + a3;
          let diff13 = a1 - a3;
          let minusIDiff13 = vec2<f32>(diff13.y, -diff13.x);
          let plusIDiff13 = vec2<f32>(-diff13.y, diff13.x);
          writeColB(lane, o0, readEven, sum02 + sum13);
          writeColB(lane, o1, readEven, diff02 + minusIDiff13);
          writeColB(lane, o2, readEven, sum02 - sum13);
          writeColB(lane, o3, readEven, diff02 + plusIDiff13);
        }
      }
    } else {
      for (var j = t; j < butterflyCount; j += threadCount) {
        let k = j % stride;
        let block = j / stride;
        let aIndex = block * stride + k;
        let bIndex = aIndex + butterflyCount;
        let w = getColTwiddle(k * twiddleScale);
        let outEven = block * (stride * 2u) + k;
        let outOdd = outEven + stride;
        {
          let a = readColA(lane, aIndex, readEven);
          let b = mul(readColA(lane, bIndex, readEven), w);
          writeColA(lane, outEven, readEven, a + b);
          writeColA(lane, outOdd, readEven, a - b);
        }
        {
          let a = readColB(lane, aIndex, readEven);
          let b = mul(readColB(lane, bIndex, readEven), w);
          writeColB(lane, outEven, readEven, a + b);
          writeColB(lane, outOdd, readEven, a - b);
        }
      }
    }

    stride = stride * factor;
    workgroupBarrier();
  }
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

fn getRowA(index: u32, lane: u32) -> vec2<f32> {
  return readColA(lane, index, (columnFactorCount() & 1u) == 0u);
}

fn getRowB(index: u32, lane: u32) -> vec2<f32> {
  return readColB(lane, index, (columnFactorCount() & 1u) == 0u);
}

fn complexStride() -> u32 {
  return params.windowSize + 2u;
}

fn writeBin(spectrumOffset: u32, k: u32, value: vec2<f32>) {
  let index = spectrumOffset + 2u * k;
  spectrum[index] = value.x;
  spectrum[index + 1u] = value.y;
}

@compute @workgroup_size(64, 4)
fn main(
  @builtin(workgroup_id) workgroupId: vec3<u32>,
  @builtin(local_invocation_id) localId: vec3<u32>,
) {
  let pairIndex = workgroupId.x * batchSize + localId.y;
  let windowIndex = workgroupId.y;
  if (windowIndex >= params.windowCount) {
    return;
  }

  let t = localId.x;
  let lane = localId.y;
  let rowA = pairIndex;
  var rowB = 0u;
  if (pairIndex == 0u || pairIndex == rowHalfSize) {
    rowB = rowA;
  } else {
    rowB = rowSize - pairIndex;
  }

  for (var i = t; i < columnSize; i += threadCount) {
    if (pairIndex >= rowPairCount) {
      continue;
    }

    let scratchOffset = packedWindowSize * windowIndex;
    let rowAIndex = scratchOffset + rowA * columnSize + i;
    let rowBIndex = scratchOffset + rowB * columnSize + i;
    let rowAValue = scratch[rowAIndex];
    let rowBValue = scratch[rowBIndex];
    rowAReal0[smIndex(lane, i)] = rowAValue.x;
    rowAImag0[smIndex(lane, i)] = rowAValue.y;
    rowBReal0[smIndex(lane, i)] = rowBValue.x;
    rowBImag0[smIndex(lane, i)] = rowBValue.y;
  }
  workgroupBarrier();

  runColumnFftPair(t, lane);

  if (pairIndex >= rowPairCount) {
    return;
  }

  let spectrumOffset = complexStride() * windowIndex;

  for (var i = t; i < columnSize; i += threadCount) {
    if (pairIndex == 0u) {
      if (i == 0u) {
        let z0 = getRowA(0u, lane);
        writeBin(spectrumOffset, 0u, vec2<f32>(z0.x + z0.y, 0.0));
        writeBin(
          spectrumOffset,
          positiveWindowSize,
          vec2<f32>(z0.x - z0.y, 0.0),
        );
      } else {
        let k = i * rowSize;
        let mirrorIndex = columnSize - i;
        writeBin(
          spectrumOffset,
          k,
          r2cBin(k, getRowA(i, lane), getRowA(mirrorIndex, lane)),
        );
      }
    } else if (pairIndex == rowHalfSize) {
      let k = pairIndex + rowSize * i;
      let mirrorIndex = columnSize - 1u - i;
      writeBin(
        spectrumOffset,
        k,
        r2cBin(k, getRowA(i, lane), getRowA(mirrorIndex, lane)),
      );
    } else {
      let mirrorIndex = columnSize - 1u - i;
      let kA = rowA + rowSize * i;
      let kB = rowB + rowSize * mirrorIndex;
      let valueA = getRowA(i, lane);
      let valueB = getRowB(mirrorIndex, lane);
      writeBin(spectrumOffset, kA, r2cBin(kA, valueA, valueB));
      writeBin(spectrumOffset, kB, r2cBin(kB, valueB, valueA));
    }
  }
}
`;
