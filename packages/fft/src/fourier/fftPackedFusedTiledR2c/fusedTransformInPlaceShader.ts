export const fusedTransformInPlaceShader = `
override packedWindowSize: u32 = 4096u;
override positiveWindowSize: u32 = 4096u;
override rowSize: u32 = 64u;
override columnSize: u32 = 64u;
override rowRadix4StageCount: u32 = 0u;
override rowRadix2StageCount: u32 = 0u;
override rowRadix3StageCount: u32 = 0u;
override rowRadix5StageCount: u32 = 0u;
override columnRadix4StageCount: u32 = 0u;
override columnRadix2StageCount: u32 = 0u;
override columnRadix3StageCount: u32 = 0u;
override columnRadix5StageCount: u32 = 0u;

override threadCount: u32 = 256u;

const sin3: f32 = 0.86602540378443864676;
const cos5a: f32 = 0.30901699437494742410;
const cos5b: f32 = -0.80901699437494742410;
const sin5a: f32 = 0.95105651629515357212;
const sin5b: f32 = 0.58778525229247312917;

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
  if (
    stage <
    rowRadix4StageCount + rowRadix2StageCount + rowRadix3StageCount
  ) {
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
  return vec2<f32>(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

fn getRowTwiddle(idx: u32) -> vec2<f32> {
  return vec2<f32>(rowTrigTable[2u * idx], -rowTrigTable[2u * idx + 1u]);
}

fn getColumnTwiddle(idx: u32) -> vec2<f32> {
  return vec2<f32>(
    columnTrigTable[2u * idx],
    -columnTrigTable[2u * idx + 1u],
  );
}

fn reverseRowIndex(value: u32) -> u32 {
  var v = value;
  var result = 0u;
  var remainingProduct = rowSize;

  for (var i = 0u; i < rowRadix4StageCount; i++) {
    remainingProduct = remainingProduct / 4u;
    result = result + (v % 4u) * remainingProduct;
    v = v / 4u;
  }

  for (var i = 0u; i < rowRadix2StageCount; i++) {
    remainingProduct = remainingProduct / 2u;
    result = result + (v % 2u) * remainingProduct;
    v = v / 2u;
  }

  for (var i = 0u; i < rowRadix3StageCount; i++) {
    remainingProduct = remainingProduct / 3u;
    result = result + (v % 3u) * remainingProduct;
    v = v / 3u;
  }

  for (var i = 0u; i < rowRadix5StageCount; i++) {
    remainingProduct = remainingProduct / 5u;
    result = result + (v % 5u) * remainingProduct;
    v = v / 5u;
  }

  return result;
}

fn reverseColumnIndex(value: u32) -> u32 {
  var v = value;
  var result = 0u;
  var remainingProduct = columnSize;

  for (var i = 0u; i < columnRadix4StageCount; i++) {
    remainingProduct = remainingProduct / 4u;
    result = result + (v % 4u) * remainingProduct;
    v = v / 4u;
  }

  for (var i = 0u; i < columnRadix2StageCount; i++) {
    remainingProduct = remainingProduct / 2u;
    result = result + (v % 2u) * remainingProduct;
    v = v / 2u;
  }

  for (var i = 0u; i < columnRadix3StageCount; i++) {
    remainingProduct = remainingProduct / 3u;
    result = result + (v % 3u) * remainingProduct;
    v = v / 3u;
  }

  for (var i = 0u; i < columnRadix5StageCount; i++) {
    remainingProduct = remainingProduct / 5u;
    result = result + (v % 5u) * remainingProduct;
    v = v / 5u;
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
  let rowPos = reverseRowIndex(iPrime);
  let colPos = reverseColumnIndex(j);
  let idx = rowPos * columnSize + colPos;
  return vec2<f32>(smReal[idx], smImag[idx]);
}

fn runRowFft(t: u32) {
  var rowLen = rowSize;
  for (var stage = 0u; stage < getRowFactorCount(); stage++) {
    let factor = getRowFactor(stage);
    let quarter = rowLen / factor;
    let twiddleStep = rowSize / rowLen;
    let butterflyCount = rowSize / factor;
    let totalButterflies = butterflyCount * columnSize;

    for (var j = t; j < totalButterflies; j += threadCount) {
      let n1 = j % columnSize;
      let bIdx = j / columnSize;
      let k = bIdx % quarter;
      let block = bIdx / quarter;

      var values: array<vec2<f32>, 5>;
      for (var q = 0u; q < factor; q++) {
        let inputRow = block * rowLen + k + q * quarter;
        let smIdx = inputRow * columnSize + n1;
        values[q] = vec2<f32>(smReal[smIdx], smImag[smIdx]);
      }

      let base = block * rowLen + k;
      let stageTwiddle = (k * twiddleStep) % rowSize;
      if (factor == 2u) {
        let a0 = values[0];
        let a1 = values[1];
        let o0 = base * columnSize + n1;
        let o1 = (base + quarter) * columnSize + n1;
        let r1 = mul(a0 - a1, getRowTwiddle(stageTwiddle));
        smReal[o0] = a0.x + a1.x;
        smImag[o0] = a0.y + a1.y;
        smReal[o1] = r1.x;
        smImag[o1] = r1.y;
      } else if (factor == 4u) {
        let a0 = values[0];
        let a1 = values[1];
        let a2 = values[2];
        let a3 = values[3];
        let sum02 = a0 + a2;
        let diff02 = a0 - a2;
        let sum13 = a1 + a3;
        let diff13 = a1 - a3;
        let r0 = sum02 + sum13;
        let r1 = mul(
          diff02 + vec2<f32>(diff13.y, -diff13.x),
          getRowTwiddle(stageTwiddle),
        );
        let r2 = mul(sum02 - sum13, getRowTwiddle((2u * stageTwiddle) % rowSize));
        let r3 = mul(
          diff02 + vec2<f32>(-diff13.y, diff13.x),
          getRowTwiddle((3u * stageTwiddle) % rowSize),
        );
        let o0 = base * columnSize + n1;
        let o1 = (base + quarter) * columnSize + n1;
        let o2 = (base + 2u * quarter) * columnSize + n1;
        let o3 = (base + 3u * quarter) * columnSize + n1;
        smReal[o0] = r0.x; smImag[o0] = r0.y;
        smReal[o1] = r1.x; smImag[o1] = r1.y;
        smReal[o2] = r2.x; smImag[o2] = r2.y;
        smReal[o3] = r3.x; smImag[o3] = r3.y;
      } else if (factor == 3u) {
        let t1 = values[1] + values[2];
        let m = values[0] - 0.5 * t1;
        let d = values[2] - values[1];
        let ids = vec2<f32>(-sin3 * d.y, sin3 * d.x);
        let o0 = base * columnSize + n1;
        let o1 = (base + quarter) * columnSize + n1;
        let o2 = (base + 2u * quarter) * columnSize + n1;
        let v0 = values[0] + t1;
        let v1 = mul(m + ids, getRowTwiddle(stageTwiddle));
        let v2 = mul(m - ids, getRowTwiddle((2u * stageTwiddle) % rowSize));
        smReal[o0] = v0.x; smImag[o0] = v0.y;
        smReal[o1] = v1.x; smImag[o1] = v1.y;
        smReal[o2] = v2.x; smImag[o2] = v2.y;
      } else if (factor == 5u) {
        let t1 = values[1] + values[4];
        let t2 = values[2] + values[3];
        let t3 = values[1] - values[4];
        let t4 = values[2] - values[3];
        let b1 = values[0] + cos5a * t1 + cos5b * t2;
        let b2 = values[0] + cos5b * t1 + cos5a * t2;
        let b3 = sin5a * t3 + sin5b * t4;
        let b4 = sin5b * t3 - sin5a * t4;
        let o0 = base * columnSize + n1;
        let o1 = (base + quarter) * columnSize + n1;
        let o2 = (base + 2u * quarter) * columnSize + n1;
        let o3 = (base + 3u * quarter) * columnSize + n1;
        let o4 = (base + 4u * quarter) * columnSize + n1;
        let v0 = values[0] + t1 + t2;
        let v1 = mul(b1 + vec2<f32>(b3.y, -b3.x), getRowTwiddle(stageTwiddle));
        let v2 = mul(
          b2 + vec2<f32>(b4.y, -b4.x),
          getRowTwiddle((2u * stageTwiddle) % rowSize),
        );
        let v3 = mul(
          b2 + vec2<f32>(-b4.y, b4.x),
          getRowTwiddle((3u * stageTwiddle) % rowSize),
        );
        let v4 = mul(
          b1 + vec2<f32>(-b3.y, b3.x),
          getRowTwiddle((4u * stageTwiddle) % rowSize),
        );
        smReal[o0] = v0.x; smImag[o0] = v0.y;
        smReal[o1] = v1.x; smImag[o1] = v1.y;
        smReal[o2] = v2.x; smImag[o2] = v2.y;
        smReal[o3] = v3.x; smImag[o3] = v3.y;
        smReal[o4] = v4.x; smImag[o4] = v4.y;
      } else {
        for (var r = 0u; r < factor; r++) {
          var sum = vec2<f32>(0.0, 0.0);
          for (var q = 0u; q < factor; q++) {
            let twiddleIndex =
              (r * (k * twiddleStep + q * (rowSize / factor))) % rowSize;
            var value = values[q];
            value = mul(value, getRowTwiddle(twiddleIndex));
            sum += value;
          }
          let outputRow = block * rowLen + k + r * quarter;
          let outIdx = outputRow * columnSize + n1;
          smReal[outIdx] = sum.x;
          smImag[outIdx] = sum.y;
        }
      }
    }
    rowLen = quarter;
    workgroupBarrier();
  }
}

fn applyFourStepTwiddle(t: u32) {
  for (var p = t; p < packedWindowSize; p += threadCount) {
    let rowPos = p / columnSize;
    let n1 = p % columnSize;
    let iPrime = reverseRowIndex(rowPos);
    let twiddleIdx = iPrime * columnSize + n1;
    let twR = fourStepTrigTable[2u * twiddleIdx];
    let twI = -fourStepTrigTable[2u * twiddleIdx + 1u];

    let real = smReal[p];
    let imag = smImag[p];
    smReal[p] = real * twR - imag * twI;
    smImag[p] = real * twI + imag * twR;
  }
  workgroupBarrier();
}

fn runColumnFft(t: u32) {
  var columnLen = columnSize;
  for (var stage = 0u; stage < getColumnFactorCount(); stage++) {
    let factor = getColumnFactor(stage);
    let quarter = columnLen / factor;
    let twiddleStep = columnSize / columnLen;
    let butterflyCount = columnSize / factor;
    let totalButterflies = rowSize * butterflyCount;

    for (var j = t; j < totalButterflies; j += threadCount) {
      let rowPos = j / butterflyCount;
      let bIdx = j % butterflyCount;
      let k = bIdx % quarter;
      let block = bIdx / quarter;

      var values: array<vec2<f32>, 5>;
      for (var q = 0u; q < factor; q++) {
        let inputCol = block * columnLen + k + q * quarter;
        let smIdx = rowPos * columnSize + inputCol;
        values[q] = vec2<f32>(smReal[smIdx], smImag[smIdx]);
      }

      let base = block * columnLen + k;
      let stageTwiddle = (k * twiddleStep) % columnSize;
      if (factor == 2u) {
        let a0 = values[0];
        let a1 = values[1];
        let o0 = rowPos * columnSize + base;
        let o1 = rowPos * columnSize + base + quarter;
        let r1 = mul(a0 - a1, getColumnTwiddle(stageTwiddle));
        smReal[o0] = a0.x + a1.x;
        smImag[o0] = a0.y + a1.y;
        smReal[o1] = r1.x;
        smImag[o1] = r1.y;
      } else if (factor == 4u) {
        let a0 = values[0];
        let a1 = values[1];
        let a2 = values[2];
        let a3 = values[3];
        let sum02 = a0 + a2;
        let diff02 = a0 - a2;
        let sum13 = a1 + a3;
        let diff13 = a1 - a3;
        let r0 = sum02 + sum13;
        let r1 = mul(
          diff02 + vec2<f32>(diff13.y, -diff13.x),
          getColumnTwiddle(stageTwiddle),
        );
        let r2 = mul(
          sum02 - sum13,
          getColumnTwiddle((2u * stageTwiddle) % columnSize),
        );
        let r3 = mul(
          diff02 + vec2<f32>(-diff13.y, diff13.x),
          getColumnTwiddle((3u * stageTwiddle) % columnSize),
        );
        let o0 = rowPos * columnSize + base;
        let o1 = rowPos * columnSize + base + quarter;
        let o2 = rowPos * columnSize + base + 2u * quarter;
        let o3 = rowPos * columnSize + base + 3u * quarter;
        smReal[o0] = r0.x; smImag[o0] = r0.y;
        smReal[o1] = r1.x; smImag[o1] = r1.y;
        smReal[o2] = r2.x; smImag[o2] = r2.y;
        smReal[o3] = r3.x; smImag[o3] = r3.y;
      } else if (factor == 3u) {
        let t1 = values[1] + values[2];
        let m = values[0] - 0.5 * t1;
        let d = values[2] - values[1];
        let ids = vec2<f32>(-sin3 * d.y, sin3 * d.x);
        let o0 = rowPos * columnSize + base;
        let o1 = rowPos * columnSize + base + quarter;
        let o2 = rowPos * columnSize + base + 2u * quarter;
        let v0 = values[0] + t1;
        let v1 = mul(m + ids, getColumnTwiddle(stageTwiddle));
        let v2 = mul(m - ids, getColumnTwiddle((2u * stageTwiddle) % columnSize));
        smReal[o0] = v0.x; smImag[o0] = v0.y;
        smReal[o1] = v1.x; smImag[o1] = v1.y;
        smReal[o2] = v2.x; smImag[o2] = v2.y;
      } else if (factor == 5u) {
        let t1 = values[1] + values[4];
        let t2 = values[2] + values[3];
        let t3 = values[1] - values[4];
        let t4 = values[2] - values[3];
        let b1 = values[0] + cos5a * t1 + cos5b * t2;
        let b2 = values[0] + cos5b * t1 + cos5a * t2;
        let b3 = sin5a * t3 + sin5b * t4;
        let b4 = sin5b * t3 - sin5a * t4;
        let o0 = rowPos * columnSize + base;
        let o1 = rowPos * columnSize + base + quarter;
        let o2 = rowPos * columnSize + base + 2u * quarter;
        let o3 = rowPos * columnSize + base + 3u * quarter;
        let o4 = rowPos * columnSize + base + 4u * quarter;
        let v0 = values[0] + t1 + t2;
        let v1 = mul(
          b1 + vec2<f32>(b3.y, -b3.x),
          getColumnTwiddle(stageTwiddle),
        );
        let v2 = mul(
          b2 + vec2<f32>(b4.y, -b4.x),
          getColumnTwiddle((2u * stageTwiddle) % columnSize),
        );
        let v3 = mul(
          b2 + vec2<f32>(-b4.y, b4.x),
          getColumnTwiddle((3u * stageTwiddle) % columnSize),
        );
        let v4 = mul(
          b1 + vec2<f32>(-b3.y, b3.x),
          getColumnTwiddle((4u * stageTwiddle) % columnSize),
        );
        smReal[o0] = v0.x; smImag[o0] = v0.y;
        smReal[o1] = v1.x; smImag[o1] = v1.y;
        smReal[o2] = v2.x; smImag[o2] = v2.y;
        smReal[o3] = v3.x; smImag[o3] = v3.y;
        smReal[o4] = v4.x; smImag[o4] = v4.y;
      } else {
        for (var r = 0u; r < factor; r++) {
          var sum = vec2<f32>(0.0, 0.0);
          for (var q = 0u; q < factor; q++) {
            let twiddleIndex =
              (r * (k * twiddleStep + q * (columnSize / factor))) % columnSize;
            var value = values[q];
            value = mul(value, getColumnTwiddle(twiddleIndex));
            sum += value;
          }
          let outputCol = block * columnLen + k + r * quarter;
          let outIdx = rowPos * columnSize + outputCol;
          smReal[outIdx] = sum.x;
          smImag[outIdx] = sum.y;
        }
      }
    }
    columnLen = quarter;
    workgroupBarrier();
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

  let t = localId.x;
  let windowOffset = params.windowSize * windowIndex;

  for (var p = t; p < packedWindowSize; p += threadCount) {
    let sampleIndex = p * 2u;
    smReal[p] = signalReal[windowOffset + sampleIndex];
    smImag[p] = signalReal[windowOffset + sampleIndex + 1u];
  }
  workgroupBarrier();

  runRowFft(t);
  applyFourStepTwiddle(t);
  runColumnFft(t);

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
`;
