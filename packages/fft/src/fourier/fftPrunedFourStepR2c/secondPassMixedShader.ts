export const secondPassMixedShader = `
override packedWindowSize: u32 = 4096u;
override positiveWindowSize: u32 = 4096u;
override tileSize: u32 = 64u;
override rowSize: u32 = 64u;
override rowPairCount: u32 = 33u;
override columnSize: u32 = 64u;
override columnRadix4StageCount: u32 = 0u;
override columnRadix2StageCount: u32 = 0u;
override columnRadix3StageCount: u32 = 0u;
override columnRadix5StageCount: u32 = 0u;

const threadCount: u32 = 64u;

struct Params {
  windowSize: u32,
  windowCount: u32,
};

var<workgroup> rowAReal0: array<f32, tileSize>;
var<workgroup> rowAImag0: array<f32, tileSize>;
var<workgroup> rowAReal1: array<f32, tileSize>;
var<workgroup> rowAImag1: array<f32, tileSize>;
var<workgroup> rowBReal0: array<f32, tileSize>;
var<workgroup> rowBImag0: array<f32, tileSize>;
var<workgroup> rowBReal1: array<f32, tileSize>;
var<workgroup> rowBImag1: array<f32, tileSize>;

@group(0) @binding(0) var<storage, read> scratch: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read_write> signalReal: array<f32>;
@group(0) @binding(2) var<storage, read_write> signalImag: array<f32>;
@group(0) @binding(3) var<storage, read> columnTrigTable: array<f32>;
@group(0) @binding(4) var<storage, read> r2cTrigTable: array<f32>;
@group(0) @binding(5) var<uniform> params: Params;

fn getColumnFactorCount() -> u32 {
  return columnRadix4StageCount +
    columnRadix2StageCount +
    columnRadix3StageCount +
    columnRadix5StageCount;
}

fn getColumnFactor(stage: u32) -> u32 {
  if (stage < columnRadix4StageCount) {
    return 4u;
  }
  if (stage < columnRadix4StageCount + columnRadix2StageCount) {
    return 2u;
  }
  if (
    stage <
    columnRadix4StageCount + columnRadix2StageCount + columnRadix3StageCount
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

fn getColumnTwiddle(index: u32) -> vec2<f32> {
  return vec2<f32>(
    columnTrigTable[2u * index],
    -columnTrigTable[2u * index + 1u],
  );
}

fn readRowA(index: u32, readEven: bool) -> vec2<f32> {
  if (readEven) {
    return vec2<f32>(rowAReal0[index], rowAImag0[index]);
  }
  return vec2<f32>(rowAReal1[index], rowAImag1[index]);
}

fn readRowB(index: u32, readEven: bool) -> vec2<f32> {
  if (readEven) {
    return vec2<f32>(rowBReal0[index], rowBImag0[index]);
  }
  return vec2<f32>(rowBReal1[index], rowBImag1[index]);
}

fn writeRows(
  index: u32,
  readEven: bool,
  valueA: vec2<f32>,
  valueB: vec2<f32>,
) {
  if (readEven) {
    rowAReal1[index] = valueA.x;
    rowAImag1[index] = valueA.y;
    rowBReal1[index] = valueB.x;
    rowBImag1[index] = valueB.y;
  } else {
    rowAReal0[index] = valueA.x;
    rowAImag0[index] = valueA.y;
    rowBReal0[index] = valueB.x;
    rowBImag0[index] = valueB.y;
  }
}

fn runFftPair(t: u32) {
  var stageStride = 1u;
  for (var stage = 0u; stage < getColumnFactorCount(); stage++) {
    let factor = getColumnFactor(stage);
    let readEven = (stage & 1u) == 0u;
    let butterflyCount = columnSize / factor;
    let twiddleScale = columnSize / (stageStride * factor);

    for (var j = t; j < butterflyCount; j += threadCount) {
      let k = j % stageStride;
      let block = j / stageStride;
      let stageTwiddle = (k * twiddleScale) % columnSize;
      let i0 = block * stageStride + k;
      let o0 = block * (stageStride * factor) + k;

      if (factor == 2u) {
        let w1 = getColumnTwiddle(stageTwiddle);
        let a0 = readRowA(i0, readEven);
        let b0 = readRowB(i0, readEven);
        let a1 = mul(readRowA(i0 + butterflyCount, readEven), w1);
        let b1 = mul(readRowB(i0 + butterflyCount, readEven), w1);
        writeRows(o0, readEven, a0 + a1, b0 + b1);
        writeRows(o0 + stageStride, readEven, a0 - a1, b0 - b1);
      } else if (factor == 4u) {
        let w1 = getColumnTwiddle(stageTwiddle);
        let w2 = getColumnTwiddle((2u * stageTwiddle) % columnSize);
        let w3 = getColumnTwiddle((3u * stageTwiddle) % columnSize);
        let a0 = readRowA(i0, readEven);
        let a1 = mul(readRowA(i0 + butterflyCount, readEven), w1);
        let a2 = mul(readRowA(i0 + 2u * butterflyCount, readEven), w2);
        let a3 = mul(readRowA(i0 + 3u * butterflyCount, readEven), w3);
        let b0 = readRowB(i0, readEven);
        let b1 = mul(readRowB(i0 + butterflyCount, readEven), w1);
        let b2 = mul(readRowB(i0 + 2u * butterflyCount, readEven), w2);
        let b3 = mul(readRowB(i0 + 3u * butterflyCount, readEven), w3);
        let aSum02 = a0 + a2; let aDiff02 = a0 - a2;
        let aSum13 = a1 + a3; let aDiff13 = a1 - a3;
        let bSum02 = b0 + b2; let bDiff02 = b0 - b2;
        let bSum13 = b1 + b3; let bDiff13 = b1 - b3;
        let o1 = o0 + stageStride;
        let o2 = o1 + stageStride;
        let o3 = o2 + stageStride;
        writeRows(o0, readEven, aSum02 + aSum13, bSum02 + bSum13);
        writeRows(
          o1, readEven,
          aDiff02 + vec2<f32>(aDiff13.y, -aDiff13.x),
          bDiff02 + vec2<f32>(bDiff13.y, -bDiff13.x),
        );
        writeRows(o2, readEven, aSum02 - aSum13, bSum02 - bSum13);
        writeRows(
          o3, readEven,
          aDiff02 + vec2<f32>(-aDiff13.y, aDiff13.x),
          bDiff02 + vec2<f32>(-bDiff13.y, bDiff13.x),
        );
      } else {
        for (var r = 0u; r < factor; r++) {
          var sumA = vec2<f32>(0.0, 0.0);
          var sumB = vec2<f32>(0.0, 0.0);
          for (var q = 0u; q < factor; q++) {
            let inputIndex = block * stageStride + k + q * butterflyCount;
            let twiddleIndex =
              (q * (k * twiddleScale + r * (columnSize / factor))) % columnSize;
            let twiddle = getColumnTwiddle(twiddleIndex);
            var valueA = readRowA(inputIndex, readEven);
            var valueB = readRowB(inputIndex, readEven);
            valueA = mul(valueA, twiddle);
            valueB = mul(valueB, twiddle);
            sumA += valueA;
            sumB += valueB;
          }

          let outputIndex =
            block * (stageStride * factor) + r * stageStride + k;
          writeRows(outputIndex, readEven, sumA, sumB);
        }
      }
    }

    stageStride *= factor;
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
  let columnFactorCount = getColumnFactorCount();
  if ((columnFactorCount & 1u) == 0u) {
    return vec2<f32>(rowAReal0[index], rowAImag0[index]);
  }
  return vec2<f32>(rowAReal1[index], rowAImag1[index]);
}

fn getRowB(index: u32) -> vec2<f32> {
  let columnFactorCount = getColumnFactorCount();
  if ((columnFactorCount & 1u) == 0u) {
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
  if (pairIndex >= rowPairCount || windowIndex >= params.windowCount) {
    return;
  }

  let t = localId.x;
  let rowA = pairIndex;
  var rowB = 0u;
  if (pairIndex == 0u) {
    rowB = 0u;
  } else {
    rowB = rowSize - pairIndex;
  }

  for (var i = t; i < columnSize; i += threadCount) {
    let scratchOffset = packedWindowSize * windowIndex;
    let rowAIndex = scratchOffset + rowA * columnSize + i;
    let rowBIndex = scratchOffset + rowB * columnSize + i;
    let rowAValue = scratch[rowAIndex];
    let rowBValue = scratch[rowBIndex];
    rowAReal0[i] = rowAValue.x;
    rowAImag0[i] = rowAValue.y;
    rowBReal0[i] = rowBValue.x;
    rowBImag0[i] = rowBValue.y;
  }
  workgroupBarrier();

  runFftPair(t);

  let windowOffset = params.windowSize * windowIndex;

  for (var i = t; i < columnSize; i += threadCount) {
    if (pairIndex == 0u) {
      if (i == 0u) {
        let z0 = getRowA(0u);
        writeBin(windowOffset, 0u, vec2<f32>(z0.x + z0.y, 0.0));
        writeBin(
          windowOffset,
          positiveWindowSize,
          vec2<f32>(z0.x - z0.y, 0.0),
        );
      } else {
        let k = i * rowSize;
        let mirrorIndex = columnSize - i;
        writeBin(windowOffset, k, r2cBin(k, getRowA(i), getRowA(mirrorIndex)));
      }
    } else {
      let mirrorIndex = columnSize - 1u - i;
      let kA = rowA + rowSize * i;
      let valueA = getRowA(i);
      if ((rowSize % 2u) == 0u && pairIndex == rowSize / 2u) {
        writeBin(windowOffset, kA, r2cBin(kA, valueA, getRowA(mirrorIndex)));
      } else {
        let kB = rowB + rowSize * mirrorIndex;
        let valueB = getRowB(mirrorIndex);
        writeBin(windowOffset, kA, r2cBin(kA, valueA, valueB));
        writeBin(windowOffset, kB, r2cBin(kB, valueB, valueA));
      }
    }
  }
}
`;
