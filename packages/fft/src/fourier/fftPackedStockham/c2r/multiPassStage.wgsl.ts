import { stockhamCombines } from '../butterflyLadder.wgsl.js';

export const multiPassStageShader = `
override packedWindowSize: u32 = 2560u;
override factor: u32 = 5u;
override stageStride: u32 = 1u;
override readBufferIndex: u32 = 1u;
override writeBufferIndex: u32 = 0u;
override readFromPrepack: u32 = 0u;
override writeToSignal: u32 = 0u;
override inPlace: u32 = 1u;
override twiddleSign: f32 = 1.0;

override threadCount: u32 = 64u;

struct Params {
  windowSize: u32,
  windowCount: u32,
  batchOffset: u32,
};

@group(0) @binding(0) var<storage, read_write> scratch0: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read_write> scratch1: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> fftTrigTable: array<f32>;
@group(0) @binding(3) var<uniform> params: Params;
@group(0) @binding(4) var<storage, read> sourceSpectrum: array<f32>;
@group(0) @binding(5) var<storage, read_write> signal: array<f32>;
@group(0) @binding(6) var<storage, read> r2cTrigTable: array<f32>;

var<private> windowScratchOffset: u32;
var<private> windowSpectrumOffset: u32;
var<private> windowSignalOffset: u32;
${stockhamCombines}
fn readSpectrumFloat(index: u32) -> f32 {
  if (inPlace == 1u) {
    return signal[windowSpectrumOffset + index];
  }
  return sourceSpectrum[windowSpectrumOffset + index];
}

fn readSpectrumBin(k: u32) -> vec2<f32> {
  let index = 2u * k;
  return vec2<f32>(readSpectrumFloat(index), readSpectrumFloat(index + 1u));
}

fn loadPackedSpectrum(k: u32) -> vec2<f32> {
  if (k == 0u) {
    let dc = readSpectrumFloat(0u);
    let nyquist = readSpectrumFloat(2u * packedWindowSize);
    return vec2<f32>(0.5 * (dc + nyquist), 0.5 * (dc - nyquist));
  }

  let mirrorK = packedWindowSize - k;
  let a = readSpectrumBin(k);
  let mirror = readSpectrumBin(mirrorK);
  let b = vec2<f32>(mirror.x, -mirror.y);
  let even = 0.5 * (a + b);
  let diff = 0.5 * (a - b);
  let invTwiddle = vec2<f32>(r2cTrigTable[2u * k], r2cTrigTable[2u * k + 1u]);
  let odd = mul(diff, invTwiddle);
  return even + vec2<f32>(-odd.y, odd.x);
}

fn readScratch(index: u32) -> vec2<f32> {
  if (readFromPrepack == 1u) {
    return loadPackedSpectrum(index - windowScratchOffset);
  }
  if (readBufferIndex == 0u) {
    return scratch0[index];
  }
  return scratch1[index];
}

fn writeScratch(index: u32, value: vec2<f32>) {
  if (writeToSignal == 1u) {
    let localIndex = index - windowScratchOffset;
    let scaled = value * (1.0 / f32(packedWindowSize));
    signal[windowSignalOffset + 2u * localIndex] = scaled.x;
    signal[windowSignalOffset + 2u * localIndex + 1u] = scaled.y;
    return;
  }
  if (writeBufferIndex == 0u) {
    scratch0[index] = value;
  } else {
    scratch1[index] = value;
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
  if (j >= butterflyCount) {
    return;
  }

  let k = j % stageStride;
  let block = j / stageStride;
  let twiddleScale = packedWindowSize / (stageStride * factor);
  let scratchOffset = packedWindowSize * windowIndex;
  windowScratchOffset = scratchOffset;
  windowSpectrumOffset = (params.windowSize + 2u) * windowIndex;
  windowSignalOffset = params.windowSize * windowIndex;

  if (factor == 8u) {
    let base = block * stageStride + k;
    let tw = k * twiddleScale;
    let a0 = readScratch(scratchOffset + base);
    let a1 = mul(readScratch(scratchOffset + base + butterflyCount),
      getTwiddle(tw));
    let a2 = mul(readScratch(scratchOffset + base + 2u * butterflyCount),
      getTwiddle(2u * tw));
    let a3 = mul(readScratch(scratchOffset + base + 3u * butterflyCount),
      getTwiddle(3u * tw));
    let a4 = mul(readScratch(scratchOffset + base + 4u * butterflyCount),
      getTwiddle(4u * tw));
    let a5 = mul(readScratch(scratchOffset + base + 5u * butterflyCount),
      getTwiddle(5u * tw));
    let a6 = mul(readScratch(scratchOffset + base + 6u * butterflyCount),
      getTwiddle(6u * tw));
    let a7 = mul(readScratch(scratchOffset + base + 7u * butterflyCount),
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
    let a0 = readScratch(scratchOffset + aIndex);
    let a1 = mul(readScratch(scratchOffset + bIndex),
      getTwiddle(k * twiddleScale));
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
    let a0 = readScratch(scratchOffset + r0);
    let a1 = mul(readScratch(scratchOffset + r1),
      getTwiddle(k * twiddleScale));
    let a2 = mul(readScratch(scratchOffset + r2),
      getTwiddle(2u * k * twiddleScale));
    let a3 = mul(readScratch(scratchOffset + r3),
      getTwiddle(3u * k * twiddleScale));
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
    let a0 = readScratch(scratchOffset + base);
    let a1 = mul(readScratch(scratchOffset + base + butterflyCount),
      getTwiddle(tw));
    let a2 = mul(readScratch(scratchOffset + base + 2u * butterflyCount),
      getTwiddle(2u * tw));
    let y = combineRadix3(a0, a1, a2);
    let o0 = block * (stageStride * 3u) + k;
    writeScratch(scratchOffset + o0, y[0]);
    writeScratch(scratchOffset + o0 + stageStride, y[1]);
    writeScratch(scratchOffset + o0 + 2u * stageStride, y[2]);
  } else if (factor == 5u) {
    let base = block * stageStride + k;
    let tw = k * twiddleScale;
    let a0 = readScratch(scratchOffset + base);
    let a1 = mul(readScratch(scratchOffset + base + butterflyCount),
      getTwiddle(tw));
    let a2 = mul(readScratch(scratchOffset + base + 2u * butterflyCount),
      getTwiddle(2u * tw));
    let a3 = mul(readScratch(scratchOffset + base + 3u * butterflyCount),
      getTwiddle(3u * tw));
    let a4 = mul(readScratch(scratchOffset + base + 4u * butterflyCount),
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
        var value = readScratch(scratchOffset + inputIndex);
        value = mul(value, getTwiddle(twiddleIndex));
        sum += value;
      }
      let outputIndex = block * (stageStride * factor) + r * stageStride + k;
      writeScratch(scratchOffset + outputIndex, sum);
    }
  }
}
`;
