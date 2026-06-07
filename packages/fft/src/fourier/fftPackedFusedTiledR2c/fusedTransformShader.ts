export const fusedTransformShader = `
override packedWindowSize: u32 = 2048u;
override positiveWindowSize: u32 = 2048u;
override rowSize: u32 = 64u;
override rowHalfSize: u32 = 32u;
override columnSize: u32 = 32u;
override columnHalfSize: u32 = 16u;
override log2RowSize: u32 = 6u;
override log2ColumnSize: u32 = 5u;
override log2PackedWindowSize: u32 = 11u;

const threadCount: u32 = 256u;

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
@group(0) @binding(2) var<storage, read> rowTrigTable: array<f32>;
@group(0) @binding(3) var<storage, read> columnTrigTable: array<f32>;
@group(0) @binding(4) var<storage, read> fourStepTrigTable: array<f32>;
@group(0) @binding(5) var<storage, read> r2cTrigTable: array<f32>;
@group(0) @binding(6) var<uniform> params: Params;

fn getResult(index: u32) -> vec2<f32> {
  if ((log2PackedWindowSize & 1u) == 0u) {
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

fn binSharedIndex(k: u32) -> u32 {
  let iPrime = k % rowSize;
  let j = k / rowSize;
  return iPrime * columnSize + j;
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

  for (var p = t; p < packedWindowSize; p += threadCount) {
    let sampleIndex = p * 2u;
    smReal0[p] = signalReal[windowOffset + sampleIndex];
    smImag0[p] = signalReal[windowOffset + sampleIndex + 1u];
  }
  workgroupBarrier();

  let butterfliesPerRowStage = rowHalfSize * columnSize;
  for (var stage: u32 = 0u; stage < log2RowSize; stage++) {
    let stride = 1u << stage;
    let evenStage = (stage & 1u) == 0u;

    for (var j = t; j < butterfliesPerRowStage; j += threadCount) {
      let n1 = j % columnSize;
      let bIdx = j / columnSize;
      let k = bIdx % stride;
      let block = bIdx / stride;
      let aRowIdx = block * stride + k;
      let bRowIdx = aRowIdx + rowHalfSize;
      let outEvenRowIdx = block * (stride << 1u) + k;
      let outOddRowIdx = outEvenRowIdx + stride;
      let trigIndex = k * (rowHalfSize / stride);
      let twiddleReal = rowTrigTable[2u * trigIndex];
      let twiddleImag = -rowTrigTable[2u * trigIndex + 1u];

      let aSmIdx = aRowIdx * columnSize + n1;
      let bSmIdx = bRowIdx * columnSize + n1;
      let outEvenSmIdx = outEvenRowIdx * columnSize + n1;
      let outOddSmIdx = outOddRowIdx * columnSize + n1;

      var aReal: f32;
      var aImag: f32;
      var bReal: f32;
      var bImag: f32;
      if (evenStage) {
        aReal = smReal0[aSmIdx];
        aImag = smImag0[aSmIdx];
        bReal = smReal0[bSmIdx];
        bImag = smImag0[bSmIdx];
      } else {
        aReal = smReal1[aSmIdx];
        aImag = smImag1[aSmIdx];
        bReal = smReal1[bSmIdx];
        bImag = smImag1[bSmIdx];
      }

      let productReal = bReal * twiddleReal - bImag * twiddleImag;
      let productImag = bReal * twiddleImag + bImag * twiddleReal;

      if (evenStage) {
        smReal1[outEvenSmIdx] = aReal + productReal;
        smImag1[outEvenSmIdx] = aImag + productImag;
        smReal1[outOddSmIdx] = aReal - productReal;
        smImag1[outOddSmIdx] = aImag - productImag;
      } else {
        smReal0[outEvenSmIdx] = aReal + productReal;
        smImag0[outEvenSmIdx] = aImag + productImag;
        smReal0[outOddSmIdx] = aReal - productReal;
        smImag0[outOddSmIdx] = aImag - productImag;
      }
    }
    workgroupBarrier();
  }

  let rowResultEven = (log2RowSize & 1u) == 0u;
  for (var p = t; p < packedWindowSize; p += threadCount) {
    let twiddleReal = fourStepTrigTable[2u * p];
    let twiddleImag = -fourStepTrigTable[2u * p + 1u];

    var real: f32;
    var imag: f32;
    if (rowResultEven) {
      real = smReal0[p];
      imag = smImag0[p];
    } else {
      real = smReal1[p];
      imag = smImag1[p];
    }

    let prodReal = real * twiddleReal - imag * twiddleImag;
    let prodImag = real * twiddleImag + imag * twiddleReal;

    if (rowResultEven) {
      smReal0[p] = prodReal;
      smImag0[p] = prodImag;
    } else {
      smReal1[p] = prodReal;
      smImag1[p] = prodImag;
    }
  }
  workgroupBarrier();

  let butterfliesPerColumnStage = rowSize * columnHalfSize;
  for (var stage: u32 = 0u; stage < log2ColumnSize; stage++) {
    let stride = 1u << stage;
    let totalStage = log2RowSize + stage;
    let readEven = (totalStage & 1u) == 0u;

    for (var j = t; j < butterfliesPerColumnStage; j += threadCount) {
      let row = j / columnHalfSize;
      let bIdx = j % columnHalfSize;
      let k = bIdx % stride;
      let block = bIdx / stride;
      let aColIdx = block * stride + k;
      let bColIdx = aColIdx + columnHalfSize;
      let outEvenColIdx = block * (stride << 1u) + k;
      let outOddColIdx = outEvenColIdx + stride;
      let trigIndex = k * (columnHalfSize / stride);
      let twiddleReal = columnTrigTable[2u * trigIndex];
      let twiddleImag = -columnTrigTable[2u * trigIndex + 1u];

      let aSmIdx = row * columnSize + aColIdx;
      let bSmIdx = row * columnSize + bColIdx;
      let outEvenSmIdx = row * columnSize + outEvenColIdx;
      let outOddSmIdx = row * columnSize + outOddColIdx;

      var aReal: f32;
      var aImag: f32;
      var bReal: f32;
      var bImag: f32;
      if (readEven) {
        aReal = smReal0[aSmIdx];
        aImag = smImag0[aSmIdx];
        bReal = smReal0[bSmIdx];
        bImag = smImag0[bSmIdx];
      } else {
        aReal = smReal1[aSmIdx];
        aImag = smImag1[aSmIdx];
        bReal = smReal1[bSmIdx];
        bImag = smImag1[bSmIdx];
      }

      let productReal = bReal * twiddleReal - bImag * twiddleImag;
      let productImag = bReal * twiddleImag + bImag * twiddleReal;

      if (readEven) {
        smReal1[outEvenSmIdx] = aReal + productReal;
        smImag1[outEvenSmIdx] = aImag + productImag;
        smReal1[outOddSmIdx] = aReal - productReal;
        smImag1[outOddSmIdx] = aImag - productImag;
      } else {
        smReal0[outEvenSmIdx] = aReal + productReal;
        smImag0[outEvenSmIdx] = aImag + productImag;
        smReal0[outOddSmIdx] = aReal - productReal;
        smImag0[outOddSmIdx] = aImag - productImag;
      }
    }
    workgroupBarrier();
  }

  for (var k = t; k <= packedWindowSize; k += threadCount) {
    if (k == 0u) {
      let z0 = getResult(0u);
      writeBin(windowOffset, 0u, vec2<f32>(z0.x + z0.y, 0.0));
      writeBin(
        windowOffset,
        positiveWindowSize,
        vec2<f32>(z0.x - z0.y, 0.0),
      );
    } else if (k < packedWindowSize) {
      let mirrorK = packedWindowSize - k;
      let value = getResult(binSharedIndex(k));
      let mirrorValue = getResult(binSharedIndex(mirrorK));
      writeBin(windowOffset, k, r2cBin(k, value, mirrorValue));
    }
  }
}
`;
