export const multiPassStageShader = `
override packedWindowSize: u32 = 2560u;
override factor: u32 = 5u;
override stageStride: u32 = 1u;
override readFromInput: u32 = 1u;
override readBufferIndex: u32 = 0u;
override writeBufferIndex: u32 = 0u;
override inPlace: u32 = 1u;

const threadCount: u32 = 64u;

struct Params {
  windowSize: u32,
  windowCount: u32,
};

@group(0) @binding(0) var<storage, read> wave: array<f32>;
@group(0) @binding(1) var<storage, read> spectrum: array<f32>;
@group(0) @binding(2) var<storage, read_write> scratch0: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read_write> scratch1: array<vec2<f32>>;
@group(0) @binding(4) var<storage, read> fftTrigTable: array<f32>;
@group(0) @binding(5) var<uniform> params: Params;

fn mul(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(
    a.x * b.x - a.y * b.y,
    a.x * b.y + a.y * b.x,
  );
}

fn getFftTwiddle(index: u32) -> vec2<f32> {
  return vec2<f32>(fftTrigTable[2u * index], -fftTrigTable[2u * index + 1u]);
}

fn readScratch(index: u32) -> vec2<f32> {
  if (readBufferIndex == 0u) {
    return scratch0[index];
  }
  return scratch1[index];
}

fn writeScratch(index: u32, value: vec2<f32>) {
  if (writeBufferIndex == 0u) {
    scratch0[index] = value;
  } else {
    scratch1[index] = value;
  }
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

fn readStage(windowIndex: u32, index: u32) -> vec2<f32> {
  if (readFromInput == 1u) {
    let inputOffset = getInputWindowOffset(windowIndex);
    let sampleIndex = index * 2u;
    return vec2<f32>(
      readInput(inputOffset, sampleIndex),
      readInput(inputOffset, sampleIndex + 1u),
    );
  }

  return readScratch(packedWindowSize * windowIndex + index);
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

  let butterflyCount = packedWindowSize / factor;
  let j = workgroupId.y * threadCount + localId.x;
  if (j >= butterflyCount) {
    return;
  }

  let k = j % stageStride;
  let block = j / stageStride;
  let twiddleScale = packedWindowSize / (stageStride * factor);
  let scratchOffset = packedWindowSize * windowIndex;

  if (factor == 2u) {
    let aIndex = block * stageStride + k;
    let bIndex = aIndex + butterflyCount;
    let a = readStage(windowIndex, aIndex);
    let b = mul(
      readStage(windowIndex, bIndex),
      getFftTwiddle(k * twiddleScale),
    );
    let outEven = block * (stageStride * 2u) + k;
    let outOdd = outEven + stageStride;
    writeScratch(scratchOffset + outEven, a + b);
    writeScratch(scratchOffset + outOdd, a - b);
  } else if (factor == 4u) {
    let r0 = block * stageStride + k;
    let r1 = r0 + butterflyCount;
    let r2 = r1 + butterflyCount;
    let r3 = r2 + butterflyCount;
    let a0 = readStage(windowIndex, r0);
    let a1 = mul(
      readStage(windowIndex, r1),
      getFftTwiddle(k * twiddleScale),
    );
    let a2 = mul(
      readStage(windowIndex, r2),
      getFftTwiddle(2u * k * twiddleScale),
    );
    let a3 = mul(
      readStage(windowIndex, r3),
      getFftTwiddle(3u * k * twiddleScale),
    );
    let sum02 = a0 + a2;
    let diff02 = a0 - a2;
    let sum13 = a1 + a3;
    let diff13 = a1 - a3;
    let minusIDiff13 = vec2<f32>(diff13.y, -diff13.x);
    let plusIDiff13 = vec2<f32>(-diff13.y, diff13.x);
    let i0 = block * (stageStride * 4u) + k;
    let i1 = i0 + stageStride;
    let i2 = i1 + stageStride;
    let i3 = i2 + stageStride;
    writeScratch(scratchOffset + i0, sum02 + sum13);
    writeScratch(scratchOffset + i1, diff02 + minusIDiff13);
    writeScratch(scratchOffset + i2, sum02 - sum13);
    writeScratch(scratchOffset + i3, diff02 + plusIDiff13);
  } else {
    for (var r = 0u; r < factor; r++) {
      var sum = vec2<f32>(0.0, 0.0);
      for (var q = 0u; q < factor; q++) {
        let inputIndex = block * stageStride + k + q * butterflyCount;
        let twiddleIndex =
          (q * (k * twiddleScale + r * (packedWindowSize / factor))) %
          packedWindowSize;
        var value = readStage(windowIndex, inputIndex);
        value = mul(value, getFftTwiddle(twiddleIndex));
        sum += value;
      }
      let outputIndex = block * (stageStride * factor) + r * stageStride + k;
      writeScratch(scratchOffset + outputIndex, sum);
    }
  }
}
`;
