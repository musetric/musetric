export const fusedTransformShader = `
override packedWindowSize: u32 = 2048u;
override positiveWindowSize: u32 = 2048u;
override rowSize: u32 = 64u;
override columnSize: u32 = 32u;
override rowRadix4StageCount: u32 = 0u;
override rowRadix2StageCount: u32 = 0u;
override rowRadix3StageCount: u32 = 0u;
override rowRadix5StageCount: u32 = 0u;
override columnRadix4StageCount: u32 = 0u;
override columnRadix2StageCount: u32 = 0u;
override columnRadix3StageCount: u32 = 0u;
override columnRadix5StageCount: u32 = 0u;

override threadCount: u32 = 256u;

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

fn getRowFactorCount() -> u32 {
  return rowRadix4StageCount +
    rowRadix2StageCount +
    rowRadix3StageCount +
    rowRadix5StageCount;
}

fn getColumnFactorCount() -> u32 {
  return columnRadix4StageCount +
    columnRadix2StageCount +
    columnRadix3StageCount +
    columnRadix5StageCount;
}

fn getRowFactor(stage: u32) -> u32 {
  if (stage < rowRadix4StageCount) {
    return 4u;
  }
  if (stage < rowRadix4StageCount + rowRadix2StageCount) {
    return 2u;
  }
  if (stage < rowRadix4StageCount + rowRadix2StageCount + rowRadix3StageCount) {
    return 3u;
  }
  return 5u;
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

fn getRowTwiddle(index: u32) -> vec2<f32> {
  return vec2<f32>(rowTrigTable[2u * index], -rowTrigTable[2u * index + 1u]);
}

fn getColumnTwiddle(index: u32) -> vec2<f32> {
  return vec2<f32>(
    columnTrigTable[2u * index],
    -columnTrigTable[2u * index + 1u],
  );
}

fn smIndex(row: u32, column: u32) -> u32 {
  return row * columnSize + column;
}

fn readStage(index: u32, readEven: bool) -> vec2<f32> {
  if (readEven) {
    return vec2<f32>(smReal0[index], smImag0[index]);
  }
  return vec2<f32>(smReal1[index], smImag1[index]);
}

fn writeStage(index: u32, readEven: bool, value: vec2<f32>) {
  if (readEven) {
    smReal1[index] = value.x;
    smImag1[index] = value.y;
  } else {
    smReal0[index] = value.x;
    smImag0[index] = value.y;
  }
}

fn getResult(index: u32) -> vec2<f32> {
  let rowFactorCount = getRowFactorCount();
  let columnFactorCount = getColumnFactorCount();
  if (((rowFactorCount + columnFactorCount) & 1u) == 0u) {
    return vec2<f32>(smReal0[index], smImag0[index]);
  }
  return vec2<f32>(smReal1[index], smImag1[index]);
}

fn runRowFft(t: u32) {
  var stageStride = 1u;
  for (var stage = 0u; stage < getRowFactorCount(); stage++) {
    let factor = getRowFactor(stage);
    let readEven = (stage & 1u) == 0u;
    let butterflyCount = rowSize / factor;
    let twiddleScale = rowSize / (stageStride * factor);

    for (var j = t; j < butterflyCount * columnSize; j += threadCount) {
      let n1 = j % columnSize;
      let butterfly = j / columnSize;
      let k = butterfly % stageStride;
      let block = butterfly / stageStride;
      let stageTwiddle = (k * twiddleScale) % rowSize;

      if (factor == 2u) {
        let i0 = block * stageStride + k;
        let i1 = i0 + butterflyCount;
        let a0 = readStage(smIndex(i0, n1), readEven);
        let a1 = mul(
          readStage(smIndex(i1, n1), readEven),
          getRowTwiddle(stageTwiddle),
        );
        let o0 = block * (stageStride * 2u) + k;
        writeStage(smIndex(o0, n1), readEven, a0 + a1);
        writeStage(smIndex(o0 + stageStride, n1), readEven, a0 - a1);
      } else if (factor == 4u) {
        let i0 = block * stageStride + k;
        let i1 = i0 + butterflyCount;
        let i2 = i1 + butterflyCount;
        let i3 = i2 + butterflyCount;
        let a0 = readStage(smIndex(i0, n1), readEven);
        let a1 = mul(
          readStage(smIndex(i1, n1), readEven),
          getRowTwiddle(stageTwiddle),
        );
        let a2 = mul(
          readStage(smIndex(i2, n1), readEven),
          getRowTwiddle((2u * stageTwiddle) % rowSize),
        );
        let a3 = mul(
          readStage(smIndex(i3, n1), readEven),
          getRowTwiddle((3u * stageTwiddle) % rowSize),
        );
        let sum02 = a0 + a2;
        let diff02 = a0 - a2;
        let sum13 = a1 + a3;
        let diff13 = a1 - a3;
        let o0 = block * (stageStride * 4u) + k;
        let o1 = o0 + stageStride;
        let o2 = o1 + stageStride;
        let o3 = o2 + stageStride;
        writeStage(smIndex(o0, n1), readEven, sum02 + sum13);
        writeStage(
          smIndex(o1, n1),
          readEven,
          diff02 + vec2<f32>(diff13.y, -diff13.x),
        );
        writeStage(smIndex(o2, n1), readEven, sum02 - sum13);
        writeStage(
          smIndex(o3, n1),
          readEven,
          diff02 + vec2<f32>(-diff13.y, diff13.x),
        );
      } else {
        for (var r = 0u; r < factor; r++) {
          var sum = vec2<f32>(0.0, 0.0);
          for (var q = 0u; q < factor; q++) {
            let inputRow = block * stageStride + k + q * butterflyCount;
            let twiddleIndex =
              (q * (k * twiddleScale + r * (rowSize / factor))) % rowSize;
            var value = readStage(smIndex(inputRow, n1), readEven);
            value = mul(value, getRowTwiddle(twiddleIndex));
            sum += value;
          }

          let outputRow = block * (stageStride * factor) + r * stageStride + k;
          writeStage(smIndex(outputRow, n1), readEven, sum);
        }
      }
    }

    stageStride *= factor;
    workgroupBarrier();
  }
}

fn applyFourStepTwiddle(t: u32) {
  let rowFactorCount = getRowFactorCount();
  let rowResultEven = (rowFactorCount & 1u) == 0u;
  for (var p = t; p < packedWindowSize; p += threadCount) {
    let twiddleReal = fourStepTrigTable[2u * p];
    let twiddleImag = -fourStepTrigTable[2u * p + 1u];
    let value = readStage(p, rowResultEven);
    let product = mul(value, vec2<f32>(twiddleReal, twiddleImag));

    if (rowResultEven) {
      smReal0[p] = product.x;
      smImag0[p] = product.y;
    } else {
      smReal1[p] = product.x;
      smImag1[p] = product.y;
    }
  }
  workgroupBarrier();
}

fn runColumnFft(t: u32) {
  var stageStride = 1u;
  let rowFactorCount = getRowFactorCount();
  for (var stage = 0u; stage < getColumnFactorCount(); stage++) {
    let factor = getColumnFactor(stage);
    let readEven = ((rowFactorCount + stage) & 1u) == 0u;
    let butterflyCount = columnSize / factor;
    let twiddleScale = columnSize / (stageStride * factor);

    for (var j = t; j < rowSize * butterflyCount; j += threadCount) {
      let row = j / butterflyCount;
      let butterfly = j % butterflyCount;
      let k = butterfly % stageStride;
      let block = butterfly / stageStride;
      let stageTwiddle = (k * twiddleScale) % columnSize;

      if (factor == 2u) {
        let i0 = block * stageStride + k;
        let i1 = i0 + butterflyCount;
        let a0 = readStage(smIndex(row, i0), readEven);
        let a1 = mul(
          readStage(smIndex(row, i1), readEven),
          getColumnTwiddle(stageTwiddle),
        );
        let o0 = block * (stageStride * 2u) + k;
        writeStage(smIndex(row, o0), readEven, a0 + a1);
        writeStage(smIndex(row, o0 + stageStride), readEven, a0 - a1);
      } else if (factor == 4u) {
        let i0 = block * stageStride + k;
        let i1 = i0 + butterflyCount;
        let i2 = i1 + butterflyCount;
        let i3 = i2 + butterflyCount;
        let a0 = readStage(smIndex(row, i0), readEven);
        let a1 = mul(
          readStage(smIndex(row, i1), readEven),
          getColumnTwiddle(stageTwiddle),
        );
        let a2 = mul(
          readStage(smIndex(row, i2), readEven),
          getColumnTwiddle((2u * stageTwiddle) % columnSize),
        );
        let a3 = mul(
          readStage(smIndex(row, i3), readEven),
          getColumnTwiddle((3u * stageTwiddle) % columnSize),
        );
        let sum02 = a0 + a2;
        let diff02 = a0 - a2;
        let sum13 = a1 + a3;
        let diff13 = a1 - a3;
        let o0 = block * (stageStride * 4u) + k;
        let o1 = o0 + stageStride;
        let o2 = o1 + stageStride;
        let o3 = o2 + stageStride;
        writeStage(smIndex(row, o0), readEven, sum02 + sum13);
        writeStage(
          smIndex(row, o1),
          readEven,
          diff02 + vec2<f32>(diff13.y, -diff13.x),
        );
        writeStage(smIndex(row, o2), readEven, sum02 - sum13);
        writeStage(
          smIndex(row, o3),
          readEven,
          diff02 + vec2<f32>(-diff13.y, diff13.x),
        );
      } else {
        for (var r = 0u; r < factor; r++) {
          var sum = vec2<f32>(0.0, 0.0);
          for (var q = 0u; q < factor; q++) {
            let inputColumn = block * stageStride + k + q * butterflyCount;
            let twiddleIndex =
              (q * (k * twiddleScale + r * (columnSize / factor))) % columnSize;
            var value = readStage(smIndex(row, inputColumn), readEven);
            value = mul(value, getColumnTwiddle(twiddleIndex));
            sum += value;
          }

          let outputColumn =
            block * (stageStride * factor) + r * stageStride + k;
          writeStage(smIndex(row, outputColumn), readEven, sum);
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

  runRowFft(t);
  applyFourStepTwiddle(t);
  runColumnFft(t);

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
