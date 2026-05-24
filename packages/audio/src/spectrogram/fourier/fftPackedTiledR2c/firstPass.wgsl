override packedWindowSize: u32 = 4096u;
override rowSize: u32 = 64u;
override rowHalfSize: u32 = 32u;
override columnSize: u32 = 64u;
override log2RowSize: u32 = 6u;

const batchSize: u32 = 4u;
const maxTileSize: u32 = 64u;

struct Params {
  windowSize: u32,
  windowCount: u32,
};

var<workgroup> smReal0: array<f32, 256>;
var<workgroup> smImag0: array<f32, 256>;
var<workgroup> smReal1: array<f32, 256>;
var<workgroup> smImag1: array<f32, 256>;

@group(0) @binding(0) var<storage, read> signalReal: array<f32>;
@group(0) @binding(1) var<storage, read_write> scratch: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> rowTrigTable: array<f32>;
@group(0) @binding(3) var<storage, read> fourStepTrigTable: array<f32>;
@group(0) @binding(4) var<uniform> params: Params;

fn smIndex(lane: u32, index: u32) -> u32 {
  return lane * maxTileSize + index;
}

fn runRowFft(t: u32, lane: u32) {
  for (var stage: u32 = 0u; stage < log2RowSize; stage++) {
    let stride = 1u << stage;
    let evenStage = (stage & 1u) == 0u;

    if (t < rowHalfSize) {
      let k = t % stride;
      let block = t / stride;
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

  if (t < rowSize && n1 < columnSize) {
    let packedIndex = t * columnSize + n1;
    let sampleIndex = packedIndex * 2u;
    let windowOffset = params.windowSize * windowIndex;
    smReal0[smIndex(lane, t)] = signalReal[windowOffset + sampleIndex];
    smImag0[smIndex(lane, t)] = signalReal[windowOffset + sampleIndex + 1u];
  }
  workgroupBarrier();

  runRowFft(t, lane);

  if (t >= rowSize || n1 >= columnSize) {
    return;
  }

  let twiddleIndex = t * columnSize + n1;
  let twiddleReal = fourStepTrigTable[2u * twiddleIndex];
  let twiddleImag = -fourStepTrigTable[2u * twiddleIndex + 1u];
  let result = getRowResult(t, lane);
  let productReal = result.x * twiddleReal - result.y * twiddleImag;
  let productImag = result.x * twiddleImag + result.y * twiddleReal;
  let scratchOffset = packedWindowSize * windowIndex;
  let scratchIndex = scratchOffset + t * columnSize + n1;

  scratch[scratchIndex] = vec2<f32>(productReal, productImag);
}
