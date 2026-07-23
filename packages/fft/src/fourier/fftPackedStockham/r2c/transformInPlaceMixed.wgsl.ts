import { stockhamCombines } from '../butterflyLadder.wgsl.js';

export const transformInPlaceMixedShader = `
override packedWindowSize: u32 = 2560u;
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

var<workgroup> sm: array<vec2<f32>, packedWindowSize>;

@group(0) @binding(0) var<storage, read> wave: array<f32>;
@group(0) @binding(1) var<storage, read_write> spectrum: array<f32>;
@group(0) @binding(2) var<storage, read> fftTrigTable: array<f32>;
@group(0) @binding(3) var<storage, read> r2cTrigTable: array<f32>;
@group(0) @binding(4) var<uniform> params: Params;
${stockhamCombines}
fn getFactorCount() -> u32 {
  return radix8StageCount + radix4StageCount + radix2StageCount +
    radix3StageCount + radix5StageCount;
}

fn getFactor(stage: u32) -> u32 {
  if (stage < radix8StageCount) {
    return 8u;
  }
  if (stage < radix8StageCount + radix4StageCount) {
    return 4u;
  }
  if (stage < radix8StageCount + radix4StageCount + radix2StageCount) {
    return 2u;
  }
  if (
    stage <
    radix8StageCount + radix4StageCount + radix2StageCount + radix3StageCount
  ) {
    return 3u;
  }
  return 5u;
}

fn reverseMixed(index: u32) -> u32 {
  var rev = 0u;
  var placeIn = packedWindowSize;
  var placeOut = 1u;
  for (var s = 0u; s < radix8StageCount; s++) {
    placeIn = placeIn / 8u;
    rev = rev + ((index / placeIn) % 8u) * placeOut;
    placeOut = placeOut * 8u;
  }
  for (var s = 0u; s < radix4StageCount; s++) {
    placeIn = placeIn / 4u;
    rev = rev + ((index / placeIn) % 4u) * placeOut;
    placeOut = placeOut * 4u;
  }
  for (var s = 0u; s < radix2StageCount; s++) {
    placeIn = placeIn / 2u;
    rev = rev + ((index / placeIn) % 2u) * placeOut;
    placeOut = placeOut * 2u;
  }
  for (var s = 0u; s < radix3StageCount; s++) {
    placeIn = placeIn / 3u;
    rev = rev + ((index / placeIn) % 3u) * placeOut;
    placeOut = placeOut * 3u;
  }
  for (var s = 0u; s < radix5StageCount; s++) {
    placeIn = placeIn / 5u;
    rev = rev + ((index / placeIn) % 5u) * placeOut;
    placeOut = placeOut * 5u;
  }
  return rev;
}

fn reverseRestMixed(index: u32) -> u32 {
  var rev = 0u;
  var placeIn = packedWindowSize / 8u;
  var placeOut = 1u;
  for (var s = 1u; s < radix8StageCount; s++) {
    placeIn = placeIn / 8u;
    rev = rev + ((index / placeIn) % 8u) * placeOut;
    placeOut = placeOut * 8u;
  }
  for (var s = 0u; s < radix4StageCount; s++) {
    placeIn = placeIn / 4u;
    rev = rev + ((index / placeIn) % 4u) * placeOut;
    placeOut = placeOut * 4u;
  }
  for (var s = 0u; s < radix2StageCount; s++) {
    placeIn = placeIn / 2u;
    rev = rev + ((index / placeIn) % 2u) * placeOut;
    placeOut = placeOut * 2u;
  }
  for (var s = 0u; s < radix3StageCount; s++) {
    placeIn = placeIn / 3u;
    rev = rev + ((index / placeIn) % 3u) * placeOut;
    placeOut = placeOut * 3u;
  }
  for (var s = 0u; s < radix5StageCount; s++) {
    placeIn = placeIn / 5u;
    rev = rev + ((index / placeIn) % 5u) * placeOut;
    placeOut = placeOut * 5u;
  }
  return rev;
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

fn loadPacked(inputOffset: u32, packedIndex: u32) -> vec2<f32> {
  let s = packedIndex * 2u;
  return vec2<f32>(readInput(inputOffset, s), readInput(inputOffset, s + 1u));
}

fn getResult(index: u32) -> vec2<f32> {
  return sm[index];
}

fn store(index: u32, value: vec2<f32>) {
  sm[index] = value;
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

fn writeBin(spectrumOffset: u32, k: u32, value: vec2<f32>) {
  let index = spectrumOffset + 2u * k;
  spectrum[index] = value.x;
  spectrum[index + 1u] = value.y;
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

  var stride = 1u;
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
      let dst = reverseRestMixed(j) * 8u;
      store(dst, y[0]);
      store(dst + 1u, y[1]);
      store(dst + 2u, y[2]);
      store(dst + 3u, y[3]);
      store(dst + 4u, y[4]);
      store(dst + 5u, y[5]);
      store(dst + 6u, y[6]);
      store(dst + 7u, y[7]);
    }
    workgroupBarrier();
    stride = 8u;
    firstStage = 1u;
  } else {
    for (var i = t; i < packedWindowSize; i += threadCount) {
      let sampleIndex = i * 2u;
      let value = vec2<f32>(
        readInput(inputOffset, sampleIndex),
        readInput(inputOffset, sampleIndex + 1u),
      );
      store(reverseMixed(i), value);
    }
    workgroupBarrier();
  }

  for (var stage = firstStage; stage < getFactorCount(); stage++) {
    let factor = getFactor(stage);
    let butterflyCount = packedWindowSize / factor;
    let twiddleScale = packedWindowSize / (stride * factor);

    if (factor == 8u) {
      for (var j = t; j < butterflyCount; j += threadCount) {
        let k = j % stride;
        let block = j / stride;
        let base = block * (stride * 8u) + k;
        let tw = k * twiddleScale;
        let a0 = getResult(base);
        let a1 = mul(getResult(base + stride), getTwiddle(tw));
        let a2 = mul(getResult(base + 2u * stride), getTwiddle(2u * tw));
        let a3 = mul(getResult(base + 3u * stride), getTwiddle(3u * tw));
        let a4 = mul(getResult(base + 4u * stride), getTwiddle(4u * tw));
        let a5 = mul(getResult(base + 5u * stride), getTwiddle(5u * tw));
        let a6 = mul(getResult(base + 6u * stride), getTwiddle(6u * tw));
        let a7 = mul(getResult(base + 7u * stride), getTwiddle(7u * tw));
        let y = combineRadix8(a0, a1, a2, a3, a4, a5, a6, a7);
        store(base, y[0]);
        store(base + stride, y[1]);
        store(base + 2u * stride, y[2]);
        store(base + 3u * stride, y[3]);
        store(base + 4u * stride, y[4]);
        store(base + 5u * stride, y[5]);
        store(base + 6u * stride, y[6]);
        store(base + 7u * stride, y[7]);
      }
    } else if (factor == 4u) {
      for (var j = t; j < butterflyCount; j += threadCount) {
        let k = j % stride;
        let block = j / stride;
        let base = block * (stride * 4u) + k;
        let tw = k * twiddleScale;
        let a0 = getResult(base);
        let a1 = mul(getResult(base + stride), getTwiddle(tw));
        let a2 = mul(getResult(base + 2u * stride), getTwiddle(2u * tw));
        let a3 = mul(getResult(base + 3u * stride), getTwiddle(3u * tw));
        let y = combineRadix4(a0, a1, a2, a3);
        store(base, y[0]);
        store(base + stride, y[1]);
        store(base + 2u * stride, y[2]);
        store(base + 3u * stride, y[3]);
      }
    } else if (factor == 2u) {
      for (var j = t; j < butterflyCount; j += threadCount) {
        let k = j % stride;
        let block = j / stride;
        let base = block * (stride * 2u) + k;
        let a0 = getResult(base);
        let a1 = mul(getResult(base + stride), getTwiddle(k * twiddleScale));
        let y = combineRadix2(a0, a1);
        store(base, y[0]);
        store(base + stride, y[1]);
      }
    } else if (factor == 3u) {
      for (var j = t; j < butterflyCount; j += threadCount) {
        let k = j % stride;
        let block = j / stride;
        let base = block * (stride * 3u) + k;
        let tw = k * twiddleScale;
        let a0 = getResult(base);
        let a1 = mul(getResult(base + stride), getTwiddle(tw));
        let a2 = mul(getResult(base + 2u * stride), getTwiddle(2u * tw));
        let y = combineRadix3(a0, a1, a2);
        store(base, y[0]);
        store(base + stride, y[1]);
        store(base + 2u * stride, y[2]);
      }
    } else {
      for (var j = t; j < butterflyCount; j += threadCount) {
        let k = j % stride;
        let block = j / stride;
        let base = block * (stride * 5u) + k;
        let tw = k * twiddleScale;
        let a0 = getResult(base);
        let a1 = mul(getResult(base + stride), getTwiddle(tw));
        let a2 = mul(getResult(base + 2u * stride), getTwiddle(2u * tw));
        let a3 = mul(getResult(base + 3u * stride), getTwiddle(3u * tw));
        let a4 = mul(getResult(base + 4u * stride), getTwiddle(4u * tw));
        let y = combineRadix5(a0, a1, a2, a3, a4);
        store(base, y[0]);
        store(base + stride, y[1]);
        store(base + 2u * stride, y[2]);
        store(base + 3u * stride, y[3]);
        store(base + 4u * stride, y[4]);
      }
    }

    stride = stride * factor;
    workgroupBarrier();
  }

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
