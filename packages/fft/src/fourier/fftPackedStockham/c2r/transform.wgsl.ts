import {
  stockhamCombines,
  stockhamLadderHelpers,
  stockhamLadderStages,
} from '../butterflyLadder.wgsl.js';

export const transformShader = `
override packedWindowSize: u32 = 1024u;
override positiveWindowSize: u32 = 1025u;
override radix8StageCount: u32 = 0u;
override radix4StageCount: u32 = 0u;
override radix2StageCount: u32 = 0u;
override radix3StageCount: u32 = 0u;
override radix5StageCount: u32 = 0u;
override inPlace: u32 = 1u;
override threadCount: u32 = 64u;
override twiddleSign: f32 = 1.0;

struct Params {
  windowSize: u32,
  windowCount: u32,
  batchOffset: u32,
};

var<workgroup> sm0: array<vec2<f32>, packedWindowSize>;
var<workgroup> sm1: array<vec2<f32>, packedWindowSize>;

@group(0) @binding(0) var<storage, read> sourceSpectrum: array<f32>;
@group(0) @binding(1) var<storage, read_write> signal: array<f32>;
@group(0) @binding(2) var<storage, read> fftTrigTable: array<f32>;
@group(0) @binding(3) var<storage, read> r2cTrigTable: array<f32>;
@group(0) @binding(4) var<uniform> params: Params;
${stockhamCombines}${stockhamLadderHelpers}
fn complexStride() -> u32 {
  return params.windowSize + 2u;
}

fn readSpectrumFloat(spectrumOffset: u32, index: u32) -> f32 {
  if (inPlace == 1u) {
    return signal[spectrumOffset + index];
  }
  return sourceSpectrum[spectrumOffset + index];
}

fn readSpectrumBin(spectrumOffset: u32, k: u32) -> vec2<f32> {
  let index = 2u * k;
  return vec2<f32>(
    readSpectrumFloat(spectrumOffset, index),
    readSpectrumFloat(spectrumOffset, index + 1u),
  );
}

fn loadPackedSpectrum(spectrumOffset: u32, k: u32) -> vec2<f32> {
  if (k == 0u) {
    let dc = readSpectrumFloat(spectrumOffset, 0u);
    let nyquist = readSpectrumFloat(spectrumOffset, 2u * packedWindowSize);
    return vec2<f32>(0.5 * (dc + nyquist), 0.5 * (dc - nyquist));
  }

  let mirrorK = packedWindowSize - k;
  let a = readSpectrumBin(spectrumOffset, k);
  let mirror = readSpectrumBin(spectrumOffset, mirrorK);
  let b = vec2<f32>(mirror.x, -mirror.y);
  let even = 0.5 * (a + b);
  let diff = 0.5 * (a - b);
  let invTwiddle = vec2<f32>(r2cTrigTable[2u * k], r2cTrigTable[2u * k + 1u]);
  let odd = mul(diff, invTwiddle);
  return even + vec2<f32>(-odd.y, odd.x);
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
  let spectrumOffset = complexStride() * windowIndex;
  let signalOffset = params.windowSize * windowIndex;

  if (t == 0u) {
    sm0[0u] = loadPackedSpectrum(spectrumOffset, 0u);
    if (packedWindowSize % 2u == 0u) {
      let half = packedWindowSize / 2u;
      sm0[half] = loadPackedSpectrum(spectrumOffset, half);
    }
  }
  for (var k = t + 1u; 2u * k < packedWindowSize; k += threadCount) {
    let mirrorK = packedWindowSize - k;
    let a = readSpectrumBin(spectrumOffset, k);
    let mirror = readSpectrumBin(spectrumOffset, mirrorK);
    let b = vec2<f32>(mirror.x, -mirror.y);
    let even = 0.5 * (a + b);
    let diff = 0.5 * (a - b);
    let invTwiddle = vec2<f32>(
      r2cTrigTable[2u * k],
      r2cTrigTable[2u * k + 1u],
    );
    let odd = mul(diff, invTwiddle);
    sm0[k] = vec2<f32>(even.x - odd.y, even.y + odd.x);
    sm0[mirrorK] = vec2<f32>(even.x + odd.y, odd.x - even.y);
  }
  workgroupBarrier();

  var stageStride = 1u;
  var firstStage = 0u;
${stockhamLadderStages}
  let scale = 1.0 / f32(packedWindowSize);
  for (var i = t; i < packedWindowSize; i += threadCount) {
    let value = getResult(i) * scale;
    signal[signalOffset + 2u * i] = value.x;
    signal[signalOffset + 2u * i + 1u] = value.y;
  }
}
`;
