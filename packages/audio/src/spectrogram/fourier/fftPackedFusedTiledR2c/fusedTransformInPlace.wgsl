override packedWindowSize: u32 = 4096u;
override positiveWindowSize: u32 = 4096u;
override rowSize: u32 = 64u;
override columnSize: u32 = 64u;
override log2RowSize: u32 = 6u;
override log2ColumnSize: u32 = 6u;
override log4RowSize: u32 = 3u;
override log4ColumnSize: u32 = 3u;

const threadCount: u32 = 256u;

struct Params {
  windowSize: u32,
  windowCount: u32,
};

var<workgroup> smReal: array<f32, packedWindowSize>;
var<workgroup> smImag: array<f32, packedWindowSize>;

@group(0) @binding(0) var<storage, read_write> signalReal: array<f32>;
@group(0) @binding(1) var<storage, read_write> signalImag: array<f32>;
@group(0) @binding(2) var<storage, read> rowTrigTable: array<f32>;
@group(0) @binding(3) var<storage, read> columnTrigTable: array<f32>;
@group(0) @binding(4) var<storage, read> fourStepTrigTable: array<f32>;
@group(0) @binding(5) var<storage, read> r2cTrigTable: array<f32>;
@group(0) @binding(6) var<uniform> params: Params;

fn mul(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

fn getRowTwiddle(idx: u32) -> vec2<f32> {
  return vec2<f32>(rowTrigTable[2u * idx], -rowTrigTable[2u * idx + 1u]);
}

fn getColumnTwiddle(idx: u32) -> vec2<f32> {
  return vec2<f32>(columnTrigTable[2u * idx], -columnTrigTable[2u * idx + 1u]);
}

fn reverseRadix4Row(value: u32) -> u32 {
  var v = value;
  var result = 0u;
  for (var i = 0u; i < log4RowSize; i++) {
    result = result * 4u + (v & 3u);
    v = v >> 2u;
  }
  return result;
}

fn reverseRadix4Column(value: u32) -> u32 {
  var v = value;
  var result = 0u;
  for (var i = 0u; i < log4ColumnSize; i++) {
    result = result * 4u + (v & 3u);
    v = v >> 2u;
  }
  return result;
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

fn getBinValue(k: u32) -> vec2<f32> {
  let iPrime = k % rowSize;
  let j = k / rowSize;
  let rowPos = reverseRadix4Row(iPrime);
  let colPos = reverseRadix4Column(j);
  let idx = rowPos * columnSize + colPos;
  return vec2<f32>(smReal[idx], smImag[idx]);
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
    smReal[p] = signalReal[windowOffset + sampleIndex];
    smImag[p] = signalReal[windowOffset + sampleIndex + 1u];
  }
  workgroupBarrier();

  let rowButterflyCount = rowSize / 4u;
  let totalRowButterflies = rowButterflyCount * columnSize;
  var rowLen = rowSize;
  for (var stage: u32 = 0u; stage < log4RowSize; stage++) {
    let quarter = rowLen / 4u;
    let twiddleStep = rowSize / rowLen;

    for (var j = t; j < totalRowButterflies; j += threadCount) {
      let n1 = j % columnSize;
      let bIdx = j / columnSize;
      let k = bIdx % quarter;
      let block = bIdx / quarter;
      let i0 = block * rowLen + k;
      let i1 = i0 + quarter;
      let i2 = i1 + quarter;
      let i3 = i2 + quarter;

      let smI0 = i0 * columnSize + n1;
      let smI1 = i1 * columnSize + n1;
      let smI2 = i2 * columnSize + n1;
      let smI3 = i3 * columnSize + n1;

      let a0 = vec2<f32>(smReal[smI0], smImag[smI0]);
      let a1 = vec2<f32>(smReal[smI1], smImag[smI1]);
      let a2 = vec2<f32>(smReal[smI2], smImag[smI2]);
      let a3 = vec2<f32>(smReal[smI3], smImag[smI3]);

      let sum02 = a0 + a2;
      let diff02 = a0 - a2;
      let sum13 = a1 + a3;
      let diff13 = a1 - a3;
      let minusIDiff13 = vec2<f32>(diff13.y, -diff13.x);
      let plusIDiff13 = vec2<f32>(-diff13.y, diff13.x);

      let b0 = sum02 + sum13;
      let b1 = diff02 + minusIDiff13;
      let b2 = sum02 - sum13;
      let b3 = diff02 + plusIDiff13;

      let out1 = mul(b1, getRowTwiddle(k * twiddleStep));
      let out2 = mul(b2, getRowTwiddle(2u * k * twiddleStep));
      let out3 = mul(b3, getRowTwiddle(3u * k * twiddleStep));

      smReal[smI0] = b0.x;
      smImag[smI0] = b0.y;
      smReal[smI1] = out1.x;
      smImag[smI1] = out1.y;
      smReal[smI2] = out2.x;
      smImag[smI2] = out2.y;
      smReal[smI3] = out3.x;
      smImag[smI3] = out3.y;
    }
    workgroupBarrier();
    rowLen = rowLen / 4u;
  }

  for (var p = t; p < packedWindowSize; p += threadCount) {
    let rowPos = p / columnSize;
    let n1 = p % columnSize;
    let iPrime = reverseRadix4Row(rowPos);
    let twiddleIdx = iPrime * columnSize + n1;
    let twR = fourStepTrigTable[2u * twiddleIdx];
    let twI = -fourStepTrigTable[2u * twiddleIdx + 1u];

    let real = smReal[p];
    let imag = smImag[p];
    smReal[p] = real * twR - imag * twI;
    smImag[p] = real * twI + imag * twR;
  }
  workgroupBarrier();

  let columnButterflyCount = columnSize / 4u;
  let totalColumnButterflies = rowSize * columnButterflyCount;
  var columnLen = columnSize;
  for (var stage: u32 = 0u; stage < log4ColumnSize; stage++) {
    let quarter = columnLen / 4u;
    let twiddleStep = columnSize / columnLen;

    for (var j = t; j < totalColumnButterflies; j += threadCount) {
      let rowPos = j / columnButterflyCount;
      let bIdx = j % columnButterflyCount;
      let k = bIdx % quarter;
      let block = bIdx / quarter;
      let n10 = block * columnLen + k;
      let n11 = n10 + quarter;
      let n12 = n11 + quarter;
      let n13 = n12 + quarter;

      let smI0 = rowPos * columnSize + n10;
      let smI1 = rowPos * columnSize + n11;
      let smI2 = rowPos * columnSize + n12;
      let smI3 = rowPos * columnSize + n13;

      let a0 = vec2<f32>(smReal[smI0], smImag[smI0]);
      let a1 = vec2<f32>(smReal[smI1], smImag[smI1]);
      let a2 = vec2<f32>(smReal[smI2], smImag[smI2]);
      let a3 = vec2<f32>(smReal[smI3], smImag[smI3]);

      let sum02 = a0 + a2;
      let diff02 = a0 - a2;
      let sum13 = a1 + a3;
      let diff13 = a1 - a3;
      let minusIDiff13 = vec2<f32>(diff13.y, -diff13.x);
      let plusIDiff13 = vec2<f32>(-diff13.y, diff13.x);

      let b0 = sum02 + sum13;
      let b1 = diff02 + minusIDiff13;
      let b2 = sum02 - sum13;
      let b3 = diff02 + plusIDiff13;

      let out1 = mul(b1, getColumnTwiddle(k * twiddleStep));
      let out2 = mul(b2, getColumnTwiddle(2u * k * twiddleStep));
      let out3 = mul(b3, getColumnTwiddle(3u * k * twiddleStep));

      smReal[smI0] = b0.x;
      smImag[smI0] = b0.y;
      smReal[smI1] = out1.x;
      smImag[smI1] = out1.y;
      smReal[smI2] = out2.x;
      smImag[smI2] = out2.y;
      smReal[smI3] = out3.x;
      smImag[smI3] = out3.y;
    }
    workgroupBarrier();
    columnLen = columnLen / 4u;
  }

  for (var k = t; k <= packedWindowSize; k += threadCount) {
    if (k == 0u) {
      let z0 = getBinValue(0u);
      writeBin(windowOffset, 0u, vec2<f32>(z0.x + z0.y, 0.0));
      writeBin(
        windowOffset,
        positiveWindowSize,
        vec2<f32>(z0.x - z0.y, 0.0),
      );
    } else if (k < packedWindowSize) {
      let value = getBinValue(k);
      let mirrorValue = getBinValue(packedWindowSize - k);
      writeBin(windowOffset, k, r2cBin(k, value, mirrorValue));
    }
  }
}
