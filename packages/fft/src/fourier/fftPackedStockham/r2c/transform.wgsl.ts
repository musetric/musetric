import {
  stockhamCombines,
  stockhamLadderHelpers,
  stockhamLadderStages,
} from '../butterflyLadder.wgsl.js';

export const transformShader = `
override packedWindowSize: u32 = 2048u;
override radix8StageCount: u32 = 0u;
override radix4StageCount: u32 = 0u;
override radix2StageCount: u32 = 0u;
override radix3StageCount: u32 = 0u;
override radix5StageCount: u32 = 0u;
override inPlace: u32 = 1u;
override threadCount: u32 = 256u;
override twiddleSign: f32 = -1.0;

struct Params {
  windowSize: u32,
  windowCount: u32,
  batchOffset: u32,
};

var<workgroup> sm0: array<vec2<f32>, packedWindowSize>;
var<workgroup> sm1: array<vec2<f32>, packedWindowSize>;

@group(0) @binding(0) var<storage, read> wave: array<f32>;
@group(0) @binding(1) var<storage, read_write> spectrum: array<f32>;
@group(0) @binding(2) var<storage, read> fftTrigTable: array<f32>;
@group(0) @binding(3) var<storage, read> r2cTrigTable: array<f32>;
@group(0) @binding(4) var<uniform> params: Params;
${stockhamCombines}${stockhamLadderHelpers}
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

fn writeBin(spectrumOffset: u32, k: u32, value: vec2<f32>) {
  let index = spectrumOffset + 2u * k;
  spectrum[index] = value.x;
  spectrum[index + 1u] = value.y;
}

fn loadPacked(inputOffset: u32, packedIndex: u32) -> vec2<f32> {
  let s = packedIndex * 2u;
  return vec2<f32>(readInput(inputOffset, s), readInput(inputOffset, s + 1u));
}

@compute @workgroup_size(threadCount)
fn main(
  @builtin(workgroup_id) workgroupId: vec3<u32>,
  @builtin(local_invocation_id) localId: vec3<u32>,
) {
  let windowIndex = params.batchOffset + workgroupId.x;
  if (windowIndex >= params.windowCount) {
    return;
  }

  let t = localId.x;
  let inputOffset = getInputWindowOffset(windowIndex);
  let spectrumOffset = complexStride() * windowIndex;

  var stageStride = 1u;
  var firstStage = 0u;

  if (radix8StageCount > 0u) {
    let butterflyCount = packedWindowSize / 8u;
    for (var j = t; j < butterflyCount; j += threadCount) {
      let a0 = loadPacked(inputOffset, j);
      let a1 = loadPacked(inputOffset, j + butterflyCount);
      let a2 = loadPacked(inputOffset, j + 2u * butterflyCount);
      let a3 = loadPacked(inputOffset, j + 3u * butterflyCount);
      let a4 = loadPacked(inputOffset, j + 4u * butterflyCount);
      let a5 = loadPacked(inputOffset, j + 5u * butterflyCount);
      let a6 = loadPacked(inputOffset, j + 6u * butterflyCount);
      let a7 = loadPacked(inputOffset, j + 7u * butterflyCount);
      let y = combineRadix8(a0, a1, a2, a3, a4, a5, a6, a7);
      let o0 = j * 8u;
      sm1[o0] = y[0];
      sm1[o0 + 1u] = y[1];
      sm1[o0 + 2u] = y[2];
      sm1[o0 + 3u] = y[3];
      sm1[o0 + 4u] = y[4];
      sm1[o0 + 5u] = y[5];
      sm1[o0 + 6u] = y[6];
      sm1[o0 + 7u] = y[7];
    }
    workgroupBarrier();
    stageStride = 8u;
    firstStage = 1u;
  } else {
    for (var i = t; i < packedWindowSize; i += threadCount) {
      let sampleIndex = i * 2u;
      sm0[i] = vec2<f32>(
        readInput(inputOffset, sampleIndex),
        readInput(inputOffset, sampleIndex + 1u),
      );
    }
    workgroupBarrier();
  }
${stockhamLadderStages}
  if (t == 0u) {
    let z0 = getResult(0u);
    writeBin(spectrumOffset, 0u, vec2<f32>(z0.x + z0.y, 0.0));
    writeBin(spectrumOffset, packedWindowSize, vec2<f32>(z0.x - z0.y, 0.0));
    if (packedWindowSize % 2u == 0u) {
      let half = packedWindowSize / 2u;
      let zh = getResult(half);
      writeBin(spectrumOffset, half, r2cBin(half, zh, zh));
    }
  }
  for (var k = t + 1u; 2u * k < packedWindowSize; k += threadCount) {
    let value = getResult(k);
    let mirrorValue = getResult(packedWindowSize - k);
    writeBin(spectrumOffset, k, r2cBin(k, value, mirrorValue));
    writeBin(spectrumOffset, packedWindowSize - k,
      r2cBin(packedWindowSize - k, mirrorValue, value));
  }
}
`;
