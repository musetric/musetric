export const secondPassShader = `
override packedWindowSize: u32 = 4096u;
override positiveWindowSize: u32 = 4096u;
override tileSize: u32 = 64u;
override rowSize: u32 = 64u;
override rowHalfSize: u32 = 32u;
override rowPairCount: u32 = 33u;
override columnSize: u32 = 64u;
override columnHalfSize: u32 = 32u;
override log2ColumnSize: u32 = 6u;

const threadCount: u32 = 64u;
const batchSize: u32 = 4u;

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
@group(0) @binding(1) var<storage, read_write> signalReal: array<f32>;
@group(0) @binding(2) var<storage, read_write> signalImag: array<f32>;
@group(0) @binding(3) var<storage, read> columnTrigTable: array<f32>;
@group(0) @binding(4) var<storage, read> r2cTrigTable: array<f32>;
@group(0) @binding(5) var<uniform> params: Params;

fn smIndex(lane: u32, index: u32) -> u32 {
  return lane * tileSize + index;
}

fn runColumnFftPair(t: u32, lane: u32) {
  for (var stage: u32 = 0u; stage < log2ColumnSize; stage++) {
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
  if ((log2ColumnSize & 1u) == 0u) {
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

fn getRowB(index: u32, lane: u32) -> vec2<f32> {
  if ((log2ColumnSize & 1u) == 0u) {
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

fn writeBin(windowOffset: u32, k: u32, value: vec2<f32>) {
  signalReal[windowOffset + k] = value.x;
  signalImag[windowOffset + k] = value.y;
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

  let windowOffset = params.windowSize * windowIndex;

  for (var i = t; i < columnSize; i += threadCount) {
    if (pairIndex == 0u) {
      if (i == 0u) {
        let z0 = getRowA(0u, lane);
        writeBin(windowOffset, 0u, vec2<f32>(z0.x + z0.y, 0.0));
        writeBin(
          windowOffset,
          positiveWindowSize,
          vec2<f32>(z0.x - z0.y, 0.0),
        );
      } else {
        let k = i * rowSize;
        let mirrorIndex = columnSize - i;
        writeBin(
          windowOffset,
          k,
          r2cBin(k, getRowA(i, lane), getRowA(mirrorIndex, lane)),
        );
      }
    } else if (pairIndex == rowHalfSize) {
      let k = pairIndex + rowSize * i;
      let mirrorIndex = columnSize - 1u - i;
      writeBin(
        windowOffset,
        k,
        r2cBin(k, getRowA(i, lane), getRowA(mirrorIndex, lane)),
      );
    } else {
      let mirrorIndex = columnSize - 1u - i;
      let kA = rowA + rowSize * i;
      let kB = rowB + rowSize * mirrorIndex;
      let valueA = getRowA(i, lane);
      let valueB = getRowB(mirrorIndex, lane);
      writeBin(windowOffset, kA, r2cBin(kA, valueA, valueB));
      writeBin(windowOffset, kB, r2cBin(kB, valueB, valueA));
    }
  }
}
`;
