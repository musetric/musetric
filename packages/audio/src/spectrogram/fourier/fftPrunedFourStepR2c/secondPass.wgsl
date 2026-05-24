override packedWindowSize: u32 = 4096u;
override positiveWindowSize: u32 = 4096u;
override rowSize: u32 = 64u;
override rowHalfSize: u32 = 32u;
override columnSize: u32 = 64u;
override columnHalfSize: u32 = 32u;
override log2ColumnSize: u32 = 6u;

struct Params {
  windowSize: u32,
  windowCount: u32,
};

var<workgroup> rowAReal0: array<f32, 64>;
var<workgroup> rowAImag0: array<f32, 64>;
var<workgroup> rowAReal1: array<f32, 64>;
var<workgroup> rowAImag1: array<f32, 64>;
var<workgroup> rowBReal0: array<f32, 64>;
var<workgroup> rowBImag0: array<f32, 64>;
var<workgroup> rowBReal1: array<f32, 64>;
var<workgroup> rowBImag1: array<f32, 64>;

@group(0) @binding(0) var<storage, read> scratch: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read_write> signalReal: array<f32>;
@group(0) @binding(2) var<storage, read_write> signalImag: array<f32>;
@group(0) @binding(3) var<storage, read> fft64TrigTable: array<f32>;
@group(0) @binding(4) var<storage, read> r2cTrigTable: array<f32>;
@group(0) @binding(5) var<uniform> params: Params;

fn runFft64Pair(t: u32) {
  for (var stage: u32 = 0u; stage < log2ColumnSize; stage++) {
    let stride = 1u << stage;
    let evenStage = (stage & 1u) == 0u;

    if (t < columnHalfSize) {
      let k = t % stride;
      let block = t / stride;
      let aIndex = block * stride + k;
      let bIndex = aIndex + columnHalfSize;
      let outEven = block * (stride << 1u) + k;
      let outOdd = outEven + stride;
      let trigIndex = k * (columnHalfSize / stride);
      let twiddleReal = fft64TrigTable[2u * trigIndex];
      let twiddleImag = -fft64TrigTable[2u * trigIndex + 1u];

      var aReal: f32;
      var aImag: f32;
      var bReal: f32;
      var bImag: f32;
      var rowBAr: f32;
      var rowBAi: f32;
      var rowBBr: f32;
      var rowBBi: f32;
      if (evenStage) {
        aReal = rowAReal0[aIndex];
        aImag = rowAImag0[aIndex];
        bReal = rowAReal0[bIndex];
        bImag = rowAImag0[bIndex];
        rowBAr = rowBReal0[aIndex];
        rowBAi = rowBImag0[aIndex];
        rowBBr = rowBReal0[bIndex];
        rowBBi = rowBImag0[bIndex];
      } else {
        aReal = rowAReal1[aIndex];
        aImag = rowAImag1[aIndex];
        bReal = rowAReal1[bIndex];
        bImag = rowAImag1[bIndex];
        rowBAr = rowBReal1[aIndex];
        rowBAi = rowBImag1[aIndex];
        rowBBr = rowBReal1[bIndex];
        rowBBi = rowBImag1[bIndex];
      }

      let productReal = bReal * twiddleReal - bImag * twiddleImag;
      let productImag = bReal * twiddleImag + bImag * twiddleReal;
      let rowBProductReal = rowBBr * twiddleReal - rowBBi * twiddleImag;
      let rowBProductImag = rowBBr * twiddleImag + rowBBi * twiddleReal;

      if (evenStage) {
        rowAReal1[outEven] = aReal + productReal;
        rowAImag1[outEven] = aImag + productImag;
        rowAReal1[outOdd] = aReal - productReal;
        rowAImag1[outOdd] = aImag - productImag;
        rowBReal1[outEven] = rowBAr + rowBProductReal;
        rowBImag1[outEven] = rowBAi + rowBProductImag;
        rowBReal1[outOdd] = rowBAr - rowBProductReal;
        rowBImag1[outOdd] = rowBAi - rowBProductImag;
      } else {
        rowAReal0[outEven] = aReal + productReal;
        rowAImag0[outEven] = aImag + productImag;
        rowAReal0[outOdd] = aReal - productReal;
        rowAImag0[outOdd] = aImag - productImag;
        rowBReal0[outEven] = rowBAr + rowBProductReal;
        rowBImag0[outEven] = rowBAi + rowBProductImag;
        rowBReal0[outOdd] = rowBAr - rowBProductReal;
        rowBImag0[outOdd] = rowBAi - rowBProductImag;
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

fn getRowA(index: u32) -> vec2<f32> {
  if ((log2ColumnSize & 1u) == 0u) {
    return vec2<f32>(rowAReal0[index], rowAImag0[index]);
  }
  return vec2<f32>(rowAReal1[index], rowAImag1[index]);
}

fn getRowB(index: u32) -> vec2<f32> {
  if ((log2ColumnSize & 1u) == 0u) {
    return vec2<f32>(rowBReal0[index], rowBImag0[index]);
  }
  return vec2<f32>(rowBReal1[index], rowBImag1[index]);
}

fn writeBin(windowOffset: u32, k: u32, value: vec2<f32>) {
  signalReal[windowOffset + k] = value.x;
  signalImag[windowOffset + k] = value.y;
}

@compute @workgroup_size(64)
fn main(
  @builtin(workgroup_id) workgroupId: vec3<u32>,
  @builtin(local_invocation_id) localId: vec3<u32>,
) {
  let pairIndex = workgroupId.x;
  let windowIndex = workgroupId.y;
  if (pairIndex > rowHalfSize || windowIndex >= params.windowCount) {
    return;
  }

  let t = localId.x;
  let rowA = pairIndex;
  var rowB = 0u;
  if (pairIndex == 0u || pairIndex == rowHalfSize) {
    rowB = rowA;
  } else {
    rowB = rowSize - pairIndex;
  }

  if (t < columnSize) {
    let scratchOffset = packedWindowSize * windowIndex;
    let rowAIndex = scratchOffset + rowA * columnSize + t;
    let rowBIndex = scratchOffset + rowB * columnSize + t;
    let rowAValue = scratch[rowAIndex];
    let rowBValue = scratch[rowBIndex];
    rowAReal0[t] = rowAValue.x;
    rowAImag0[t] = rowAValue.y;
    rowBReal0[t] = rowBValue.x;
    rowBImag0[t] = rowBValue.y;
  }
  workgroupBarrier();

  runFft64Pair(t);

  if (t >= columnSize) {
    return;
  }

  let windowOffset = params.windowSize * windowIndex;

  if (pairIndex == 0u) {
    if (t == 0u) {
      let z0 = getRowA(0u);
      writeBin(windowOffset, 0u, vec2<f32>(z0.x + z0.y, 0.0));
      writeBin(windowOffset, positiveWindowSize, vec2<f32>(z0.x - z0.y, 0.0));
    } else {
      let k = t * rowSize;
      let mirrorIndex = columnSize - t;
      writeBin(windowOffset, k, r2cBin(k, getRowA(t), getRowA(mirrorIndex)));
    }
    return;
  }

  if (pairIndex == rowHalfSize) {
    let k = pairIndex + rowSize * t;
    let mirrorIndex = columnSize - 1u - t;
    writeBin(windowOffset, k, r2cBin(k, getRowA(t), getRowA(mirrorIndex)));
    return;
  }

  let mirrorIndex = columnSize - 1u - t;
  let kA = rowA + rowSize * t;
  let kB = rowB + rowSize * mirrorIndex;
  let valueA = getRowA(t);
  let valueB = getRowB(mirrorIndex);
  writeBin(windowOffset, kA, r2cBin(kA, valueA, valueB));
  writeBin(windowOffset, kB, r2cBin(kB, valueB, valueA));
}
