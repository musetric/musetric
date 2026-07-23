import { stockhamCombines } from '../butterflyLadder.wgsl.js';

export const multiPassStageShader = `
override packedWindowSize: u32 = 2560u;
override factor: u32 = 5u;
override stageStride: u32 = 1u;
override readFromInput: u32 = 1u;
override readBufferIndex: u32 = 0u;
override writeBufferIndex: u32 = 0u;
override inPlace: u32 = 1u;
override fuseR2cPack: u32 = 0u;
override twiddleSign: f32 = -1.0;

override threadCount: u32 = 64u;

struct Params {
  windowSize: u32,
  windowCount: u32,
  batchOffset: u32,
};

@group(0) @binding(0) var<storage, read> wave: array<f32>;
@group(0) @binding(1) var<storage, read_write> spectrum: array<f32>;
@group(0) @binding(2) var<storage, read_write> scratch0: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read_write> scratch1: array<vec2<f32>>;
@group(0) @binding(4) var<storage, read> fftTrigTable: array<f32>;
@group(0) @binding(5) var<uniform> params: Params;
@group(0) @binding(6) var<storage, read> r2cTrigTable: array<f32>;

var<private> yOut: array<vec2<f32>, 8>;
${stockhamCombines}
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

fn r2cBin(k: u32, value: vec2<f32>, mirrorValue: vec2<f32>) -> vec2<f32> {
  let even = vec2<f32>(
    0.5 * (value.x + mirrorValue.x),
    0.5 * (value.y - mirrorValue.y),
  );
  let odd = vec2<f32>(
    0.5 * (value.y + mirrorValue.y),
    0.5 * (mirrorValue.x - value.x),
  );
  let twiddle = vec2<f32>(r2cTrigTable[2u * k], -r2cTrigTable[2u * k + 1u]);
  return even + mul(odd, twiddle);
}

fn writeBin(spectrumOffset: u32, k: u32, value: vec2<f32>) {
  let index = spectrumOffset + 2u * k;
  spectrum[index] = value.x;
  spectrum[index + 1u] = value.y;
}

fn computeLastButterfly(windowIndex: u32, k: u32) {
  let butterflyCount = packedWindowSize / factor;
  let a0 = readStage(windowIndex, k);
  if (factor == 2u) {
    let a1 = mul(readStage(windowIndex, k + butterflyCount), getTwiddle(k));
    let y = combineRadix2(a0, a1);
    yOut[0] = y[0];
    yOut[1] = y[1];
    return;
  }
  if (factor == 4u) {
    let a1 = mul(readStage(windowIndex, k + butterflyCount), getTwiddle(k));
    let a2 = mul(readStage(windowIndex, k + 2u * butterflyCount),
      getTwiddle(2u * k));
    let a3 = mul(readStage(windowIndex, k + 3u * butterflyCount),
      getTwiddle(3u * k));
    let y = combineRadix4(a0, a1, a2, a3);
    yOut[0] = y[0];
    yOut[1] = y[1];
    yOut[2] = y[2];
    yOut[3] = y[3];
    return;
  }
  if (factor == 3u) {
    let a1 = mul(readStage(windowIndex, k + butterflyCount), getTwiddle(k));
    let a2 = mul(readStage(windowIndex, k + 2u * butterflyCount),
      getTwiddle(2u * k));
    let y = combineRadix3(a0, a1, a2);
    yOut[0] = y[0];
    yOut[1] = y[1];
    yOut[2] = y[2];
    return;
  }
  if (factor == 5u) {
    let a1 = mul(readStage(windowIndex, k + butterflyCount), getTwiddle(k));
    let a2 = mul(readStage(windowIndex, k + 2u * butterflyCount),
      getTwiddle(2u * k));
    let a3 = mul(readStage(windowIndex, k + 3u * butterflyCount),
      getTwiddle(3u * k));
    let a4 = mul(readStage(windowIndex, k + 4u * butterflyCount),
      getTwiddle(4u * k));
    let y = combineRadix5(a0, a1, a2, a3, a4);
    yOut[0] = y[0];
    yOut[1] = y[1];
    yOut[2] = y[2];
    yOut[3] = y[3];
    yOut[4] = y[4];
    return;
  }
  let a1 = mul(readStage(windowIndex, k + butterflyCount), getTwiddle(k));
  let a2 = mul(readStage(windowIndex, k + 2u * butterflyCount),
    getTwiddle(2u * k));
  let a3 = mul(readStage(windowIndex, k + 3u * butterflyCount),
    getTwiddle(3u * k));
  let a4 = mul(readStage(windowIndex, k + 4u * butterflyCount),
    getTwiddle(4u * k));
  let a5 = mul(readStage(windowIndex, k + 5u * butterflyCount),
    getTwiddle(5u * k));
  let a6 = mul(readStage(windowIndex, k + 6u * butterflyCount),
    getTwiddle(6u * k));
  let a7 = mul(readStage(windowIndex, k + 7u * butterflyCount),
    getTwiddle(7u * k));
  let y = combineRadix8(a0, a1, a2, a3, a4, a5, a6, a7);
  yOut[0] = y[0];
  yOut[1] = y[1];
  yOut[2] = y[2];
  yOut[3] = y[3];
  yOut[4] = y[4];
  yOut[5] = y[5];
  yOut[6] = y[6];
  yOut[7] = y[7];
}

fn runFusedLastStage(windowIndex: u32, k: u32) {
  let spectrumOffset = complexStride() * windowIndex;
  computeLastButterfly(windowIndex, k);
  var ya = yOut;
  if (k == 0u) {
    writeBin(spectrumOffset, 0u, vec2<f32>(ya[0].x + ya[0].y, 0.0));
    writeBin(
      spectrumOffset,
      packedWindowSize,
      vec2<f32>(ya[0].x - ya[0].y, 0.0),
    );
    for (var m = 1u; m < factor; m++) {
      let i = m * stageStride;
      writeBin(spectrumOffset, i, r2cBin(i, ya[m], ya[factor - m]));
    }
    return;
  }
  computeLastButterfly(windowIndex, stageStride - k);
  var yb = yOut;
  for (var m = 0u; m < factor; m++) {
    let i = k + m * stageStride;
    let mirrorValue = yb[factor - 1u - m];
    writeBin(spectrumOffset, i, r2cBin(i, ya[m], mirrorValue));
    writeBin(
      spectrumOffset,
      packedWindowSize - i,
      r2cBin(packedWindowSize - i, mirrorValue, ya[m]),
    );
  }
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

  let butterflyCount = packedWindowSize / factor;
  let j = workgroupId.y * threadCount + localId.x;

  if (fuseR2cPack == 1u) {
    if (2u * j > stageStride) {
      return;
    }
    runFusedLastStage(windowIndex, j);
    return;
  }

  if (j >= butterflyCount) {
    return;
  }

  let k = j % stageStride;
  let block = j / stageStride;
  let twiddleScale = packedWindowSize / (stageStride * factor);
  let scratchOffset = packedWindowSize * windowIndex;

  if (factor == 8u) {
    let base = block * stageStride + k;
    let tw = k * twiddleScale;
    let a0 = readStage(windowIndex, base);
    let a1 = mul(readStage(windowIndex, base + butterflyCount),
      getTwiddle(tw));
    let a2 = mul(readStage(windowIndex, base + 2u * butterflyCount),
      getTwiddle(2u * tw));
    let a3 = mul(readStage(windowIndex, base + 3u * butterflyCount),
      getTwiddle(3u * tw));
    let a4 = mul(readStage(windowIndex, base + 4u * butterflyCount),
      getTwiddle(4u * tw));
    let a5 = mul(readStage(windowIndex, base + 5u * butterflyCount),
      getTwiddle(5u * tw));
    let a6 = mul(readStage(windowIndex, base + 6u * butterflyCount),
      getTwiddle(6u * tw));
    let a7 = mul(readStage(windowIndex, base + 7u * butterflyCount),
      getTwiddle(7u * tw));
    let y = combineRadix8(a0, a1, a2, a3, a4, a5, a6, a7);
    let o0 = block * (stageStride * 8u) + k;
    let o1 = o0 + stageStride;
    let o2 = o1 + stageStride;
    let o3 = o2 + stageStride;
    let o4 = o3 + stageStride;
    let o5 = o4 + stageStride;
    let o6 = o5 + stageStride;
    let o7 = o6 + stageStride;
    writeScratch(scratchOffset + o0, y[0]);
    writeScratch(scratchOffset + o1, y[1]);
    writeScratch(scratchOffset + o2, y[2]);
    writeScratch(scratchOffset + o3, y[3]);
    writeScratch(scratchOffset + o4, y[4]);
    writeScratch(scratchOffset + o5, y[5]);
    writeScratch(scratchOffset + o6, y[6]);
    writeScratch(scratchOffset + o7, y[7]);
  } else if (factor == 2u) {
    let aIndex = block * stageStride + k;
    let bIndex = aIndex + butterflyCount;
    let a0 = readStage(windowIndex, aIndex);
    let a1 = mul(readStage(windowIndex, bIndex), getTwiddle(k * twiddleScale));
    let y = combineRadix2(a0, a1);
    let outEven = block * (stageStride * 2u) + k;
    let outOdd = outEven + stageStride;
    writeScratch(scratchOffset + outEven, y[0]);
    writeScratch(scratchOffset + outOdd, y[1]);
  } else if (factor == 4u) {
    let r0 = block * stageStride + k;
    let r1 = r0 + butterflyCount;
    let r2 = r1 + butterflyCount;
    let r3 = r2 + butterflyCount;
    let a0 = readStage(windowIndex, r0);
    let a1 = mul(readStage(windowIndex, r1), getTwiddle(k * twiddleScale));
    let a2 = mul(readStage(windowIndex, r2), getTwiddle(2u * k * twiddleScale));
    let a3 = mul(readStage(windowIndex, r3), getTwiddle(3u * k * twiddleScale));
    let y = combineRadix4(a0, a1, a2, a3);
    let i0 = block * (stageStride * 4u) + k;
    let i1 = i0 + stageStride;
    let i2 = i1 + stageStride;
    let i3 = i2 + stageStride;
    writeScratch(scratchOffset + i0, y[0]);
    writeScratch(scratchOffset + i1, y[1]);
    writeScratch(scratchOffset + i2, y[2]);
    writeScratch(scratchOffset + i3, y[3]);
  } else if (factor == 3u) {
    let base = block * stageStride + k;
    let tw = k * twiddleScale;
    let a0 = readStage(windowIndex, base);
    let a1 = mul(readStage(windowIndex, base + butterflyCount),
      getTwiddle(tw));
    let a2 = mul(readStage(windowIndex, base + 2u * butterflyCount),
      getTwiddle(2u * tw));
    let y = combineRadix3(a0, a1, a2);
    let o0 = block * (stageStride * 3u) + k;
    writeScratch(scratchOffset + o0, y[0]);
    writeScratch(scratchOffset + o0 + stageStride, y[1]);
    writeScratch(scratchOffset + o0 + 2u * stageStride, y[2]);
  } else if (factor == 5u) {
    let base = block * stageStride + k;
    let tw = k * twiddleScale;
    let a0 = readStage(windowIndex, base);
    let a1 = mul(readStage(windowIndex, base + butterflyCount),
      getTwiddle(tw));
    let a2 = mul(readStage(windowIndex, base + 2u * butterflyCount),
      getTwiddle(2u * tw));
    let a3 = mul(readStage(windowIndex, base + 3u * butterflyCount),
      getTwiddle(3u * tw));
    let a4 = mul(readStage(windowIndex, base + 4u * butterflyCount),
      getTwiddle(4u * tw));
    let y = combineRadix5(a0, a1, a2, a3, a4);
    let o0 = block * (stageStride * 5u) + k;
    let o1 = o0 + stageStride;
    let o2 = o1 + stageStride;
    let o3 = o2 + stageStride;
    let o4 = o3 + stageStride;
    writeScratch(scratchOffset + o0, y[0]);
    writeScratch(scratchOffset + o1, y[1]);
    writeScratch(scratchOffset + o2, y[2]);
    writeScratch(scratchOffset + o3, y[3]);
    writeScratch(scratchOffset + o4, y[4]);
  } else {
    for (var r = 0u; r < factor; r++) {
      var sum = vec2<f32>(0.0, 0.0);
      for (var q = 0u; q < factor; q++) {
        let inputIndex = block * stageStride + k + q * butterflyCount;
        let twiddleIndex =
          (q * (k * twiddleScale + r * (packedWindowSize / factor))) %
          packedWindowSize;
        var value = readStage(windowIndex, inputIndex);
        value = mul(value, getTwiddle(twiddleIndex));
        sum += value;
      }
      let outputIndex = block * (stageStride * factor) + r * stageStride + k;
      writeScratch(scratchOffset + outputIndex, sum);
    }
  }
}
`;
