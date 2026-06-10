export const firstPassShader = `
override packedWindowSize: u32 = 4096u;
override tileSize: u32 = 64u;
override rowSize: u32 = 64u;
override rowHalfSize: u32 = 32u;
override columnSize: u32 = 64u;
override log2RowSize: u32 = 6u;
override inPlace: u32 = 1u;

const threadCount: u32 = 64u;
const batchSize: u32 = 4u;

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

fn runRowFft(t: u32, lane: u32) {
  for (var stage: u32 = 0u; stage < log2RowSize; stage++) {
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

fn getRowResult(index: u32, lane: u32) -> vec2<f32> {
  if ((log2RowSize & 1u) == 0u) {
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
