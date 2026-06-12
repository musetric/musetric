export const firstPassMixedShader = `
override packedWindowSize: u32 = 2560u;
override tileSize: u32 = 64u;
override rowSize: u32 = 64u;
override columnSize: u32 = 40u;
override rowRadix4StageCount: u32 = 0u;
override rowRadix2StageCount: u32 = 0u;
override rowRadix3StageCount: u32 = 0u;
override rowRadix5StageCount: u32 = 0u;
override inPlace: u32 = 1u;
// Lane stride padding keeps the four lanes of a warp on distinct shared
// memory banks now that warps span lanes first.
override smPad: u32 = 8u;

const threadCount: u32 = 64u;
const batchSize: u32 = 4u;

struct Params {
  windowSize: u32,
  windowCount: u32,
};

var<workgroup> smReal0: array<f32, batchSize * (tileSize + smPad)>;
var<workgroup> smImag0: array<f32, batchSize * (tileSize + smPad)>;
var<workgroup> smReal1: array<f32, batchSize * (tileSize + smPad)>;
var<workgroup> smImag1: array<f32, batchSize * (tileSize + smPad)>;

@group(0) @binding(0) var<storage, read> wave: array<f32>;
@group(0) @binding(1) var<storage, read> spectrum: array<f32>;
@group(0) @binding(2) var<storage, read_write> scratch: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read> rowTrigTable: array<f32>;
@group(0) @binding(4) var<storage, read> fourStepTrigTable: array<f32>;
@group(0) @binding(5) var<uniform> params: Params;

fn getRowFactorCount() -> u32 {
  return rowRadix4StageCount +
    rowRadix2StageCount +
    rowRadix3StageCount +
    rowRadix5StageCount;
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

fn smIndex(lane: u32, index: u32) -> u32 {
  return lane * (tileSize + smPad) + index;
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

fn getRowTwiddle(index: u32) -> vec2<f32> {
  return vec2<f32>(rowTrigTable[2u * index], -rowTrigTable[2u * index + 1u]);
}

fn readStage(index: u32, lane: u32, readEven: bool) -> vec2<f32> {
  if (readEven) {
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

fn writeStage(index: u32, lane: u32, readEven: bool, value: vec2<f32>) {
  if (readEven) {
    smReal1[smIndex(lane, index)] = value.x;
    smImag1[smIndex(lane, index)] = value.y;
  } else {
    smReal0[smIndex(lane, index)] = value.x;
    smImag0[smIndex(lane, index)] = value.y;
  }
}

fn runRowFft(t: u32, lane: u32) {
  var stageStride = 1u;
  for (var stage = 0u; stage < getRowFactorCount(); stage++) {
    let factor = getRowFactor(stage);
    let readEven = (stage & 1u) == 0u;
    let butterflyCount = rowSize / factor;
    let twiddleScale = rowSize / (stageStride * factor);

    for (var j = t; j < butterflyCount; j += threadCount) {
      let k = j % stageStride;
      let block = j / stageStride;
      let stageTwiddle = (k * twiddleScale) % rowSize;

      if (factor == 2u) {
        let i0 = block * stageStride + k;
        let a0 = readStage(i0, lane, readEven);
        let a1 = mul(
          readStage(i0 + butterflyCount, lane, readEven),
          getRowTwiddle(stageTwiddle),
        );
        let o0 = block * (stageStride * 2u) + k;
        writeStage(o0, lane, readEven, a0 + a1);
        writeStage(o0 + stageStride, lane, readEven, a0 - a1);
      } else if (factor == 4u) {
        let i0 = block * stageStride + k;
        let a0 = readStage(i0, lane, readEven);
        let a1 = mul(
          readStage(i0 + butterflyCount, lane, readEven),
          getRowTwiddle(stageTwiddle),
        );
        let a2 = mul(
          readStage(i0 + 2u * butterflyCount, lane, readEven),
          getRowTwiddle((2u * stageTwiddle) % rowSize),
        );
        let a3 = mul(
          readStage(i0 + 3u * butterflyCount, lane, readEven),
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
        writeStage(o0, lane, readEven, sum02 + sum13);
        writeStage(o1, lane, readEven, diff02 + vec2<f32>(diff13.y, -diff13.x));
        writeStage(o2, lane, readEven, sum02 - sum13);
        writeStage(o3, lane, readEven, diff02 + vec2<f32>(-diff13.y, diff13.x));
      } else {
        for (var r = 0u; r < factor; r++) {
          var sum = vec2<f32>(0.0, 0.0);
          for (var q = 0u; q < factor; q++) {
            let inputIndex = block * stageStride + k + q * butterflyCount;
            let twiddleIndex =
              (q * (k * twiddleScale + r * (rowSize / factor))) % rowSize;
            var value = readStage(inputIndex, lane, readEven);
            value = mul(value, getRowTwiddle(twiddleIndex));
            sum += value;
          }

          let outputIndex =
            block * (stageStride * factor) + r * stageStride + k;
          writeStage(outputIndex, lane, readEven, sum);
        }
      }
    }

    stageStride *= factor;
    workgroupBarrier();
  }
}

fn getRowResult(index: u32, lane: u32) -> vec2<f32> {
  let rowFactorCount = getRowFactorCount();
  if ((rowFactorCount & 1u) == 0u) {
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

@compute @workgroup_size(4, 64)
fn main(
  @builtin(workgroup_id) workgroupId: vec3<u32>,
  @builtin(local_invocation_id) localId: vec3<u32>,
) {
  let n1 = workgroupId.x * batchSize + localId.x;
  let windowIndex = workgroupId.y;
  if (windowIndex >= params.windowCount) {
    return;
  }

  let t = localId.y;
  let lane = localId.x;
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
