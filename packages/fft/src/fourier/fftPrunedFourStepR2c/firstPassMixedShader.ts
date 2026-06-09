export const firstPassMixedShader = `
override packedWindowSize: u32 = 4096u;
override tileSize: u32 = 64u;
override rowSize: u32 = 64u;
override columnSize: u32 = 64u;
override rowRadix4StageCount: u32 = 0u;
override rowRadix2StageCount: u32 = 0u;
override rowRadix3StageCount: u32 = 0u;
override rowRadix5StageCount: u32 = 0u;

const threadCount: u32 = 64u;

struct Params {
  windowSize: u32,
  windowCount: u32,
};

var<workgroup> smReal0: array<f32, tileSize>;
var<workgroup> smImag0: array<f32, tileSize>;
var<workgroup> smReal1: array<f32, tileSize>;
var<workgroup> smImag1: array<f32, tileSize>;

@group(0) @binding(0) var<storage, read> signalReal: array<f32>;
@group(0) @binding(1) var<storage, read_write> scratch: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> rowTrigTable: array<f32>;
@group(0) @binding(3) var<storage, read> fourStepTrigTable: array<f32>;
@group(0) @binding(4) var<uniform> params: Params;

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

fn mul(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(
    a.x * b.x - a.y * b.y,
    a.x * b.y + a.y * b.x,
  );
}

fn getRowTwiddle(index: u32) -> vec2<f32> {
  return vec2<f32>(rowTrigTable[2u * index], -rowTrigTable[2u * index + 1u]);
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

fn runFft(t: u32) {
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
      let i0 = block * stageStride + k;
      let o0 = block * (stageStride * factor) + k;

      if (factor == 2u) {
        let a0 = readStage(i0, readEven);
        let a1 = mul(
          readStage(i0 + butterflyCount, readEven),
          getRowTwiddle(stageTwiddle),
        );
        writeStage(o0, readEven, a0 + a1);
        writeStage(o0 + stageStride, readEven, a0 - a1);
      } else if (factor == 4u) {
        let a0 = readStage(i0, readEven);
        let a1 = mul(
          readStage(i0 + butterflyCount, readEven),
          getRowTwiddle(stageTwiddle),
        );
        let a2 = mul(
          readStage(i0 + 2u * butterflyCount, readEven),
          getRowTwiddle((2u * stageTwiddle) % rowSize),
        );
        let a3 = mul(
          readStage(i0 + 3u * butterflyCount, readEven),
          getRowTwiddle((3u * stageTwiddle) % rowSize),
        );
        let sum02 = a0 + a2;
        let diff02 = a0 - a2;
        let sum13 = a1 + a3;
        let diff13 = a1 - a3;
        let o1 = o0 + stageStride;
        let o2 = o1 + stageStride;
        let o3 = o2 + stageStride;
        writeStage(o0, readEven, sum02 + sum13);
        writeStage(o1, readEven, diff02 + vec2<f32>(diff13.y, -diff13.x));
        writeStage(o2, readEven, sum02 - sum13);
        writeStage(o3, readEven, diff02 + vec2<f32>(-diff13.y, diff13.x));
      } else {
        for (var r = 0u; r < factor; r++) {
          var sum = vec2<f32>(0.0, 0.0);
          for (var q = 0u; q < factor; q++) {
            let inputIndex = block * stageStride + k + q * butterflyCount;
            let twiddleIndex =
              (q * (k * twiddleScale + r * (rowSize / factor))) % rowSize;
            var value = readStage(inputIndex, readEven);
            value = mul(value, getRowTwiddle(twiddleIndex));
            sum += value;
          }

          let outputIndex =
            block * (stageStride * factor) + r * stageStride + k;
          writeStage(outputIndex, readEven, sum);
        }
      }
    }

    stageStride *= factor;
    workgroupBarrier();
  }
}

fn getRowResult(index: u32) -> vec2<f32> {
  let rowFactorCount = getRowFactorCount();
  if ((rowFactorCount & 1u) == 0u) {
    return vec2<f32>(smReal0[index], smImag0[index]);
  }
  return vec2<f32>(smReal1[index], smImag1[index]);
}

@compute @workgroup_size(64)
fn main(
  @builtin(workgroup_id) workgroupId: vec3<u32>,
  @builtin(local_invocation_id) localId: vec3<u32>,
) {
  let n1 = workgroupId.x;
  let windowIndex = workgroupId.y;
  if (n1 >= columnSize || windowIndex >= params.windowCount) {
    return;
  }

  let t = localId.x;
  let windowOffset = params.windowSize * windowIndex;

  for (var i = t; i < rowSize; i += threadCount) {
    let packedIndex = i * columnSize + n1;
    let sampleIndex = packedIndex * 2u;

    var real = 0.0;
    var imag = 0.0;
    if (sampleIndex < params.windowSize) {
      real = signalReal[windowOffset + sampleIndex];
    }
    if (sampleIndex + 1u < params.windowSize) {
      imag = signalReal[windowOffset + sampleIndex + 1u];
    }

    smReal0[i] = real;
    smImag0[i] = imag;
  }
  workgroupBarrier();

  runFft(t);

  for (var i = t; i < rowSize; i += threadCount) {
    let twiddleIndex = i * columnSize + n1;
    let twiddleReal = fourStepTrigTable[2u * twiddleIndex];
    let twiddleImag = -fourStepTrigTable[2u * twiddleIndex + 1u];
    let result = getRowResult(i);
    let productReal = result.x * twiddleReal - result.y * twiddleImag;
    let productImag = result.x * twiddleImag + result.y * twiddleReal;
    let scratchOffset = packedWindowSize * windowIndex;
    let scratchIndex = scratchOffset + i * columnSize + n1;

    scratch[scratchIndex] = vec2<f32>(productReal, productImag);
  }
}
`;
