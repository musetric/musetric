export const transformInPlaceRadix8Shader = `
override packedWindowSize: u32 = 4096u;
override log2PackedWindowSize: u32 = 12u;
override inPlace: u32 = 1u;
override threadCount: u32 = 256u;

const sqrt1_2: f32 = 0.70710678118654752440;

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

fn reverseRadix8(index: u32) -> u32 {
  var value = index;
  var result = 0u;
  for (var i = 0u; i < log2PackedWindowSize / 3u; i++) {
    result = result * 8u + value % 8u;
    value = value / 8u;
  }
  return result;
}

fn reverseRest(index: u32) -> u32 {
  var value = index;
  var result = 0u;
  for (var i = 1u; i < log2PackedWindowSize / 3u; i++) {
    result = result * 8u + value % 8u;
    value = value / 8u;
  }
  return result;
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

fn mul(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(
    a.x * b.x - a.y * b.y,
    a.x * b.y + a.y * b.x,
  );
}

fn getFftTwiddle(index: u32) -> vec2<f32> {
  return vec2<f32>(fftTrigTable[2u * index], -fftTrigTable[2u * index + 1u]);
}

fn getResult(index: u32) -> vec2<f32> {
  return sm[index];
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
  let twiddle = vec2<f32>(
    r2cTrigTable[2u * k],
    -r2cTrigTable[2u * k + 1u],
  );
  return even + mul(odd, twiddle);
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

    let e0 = a0 + a4;
    let e1 = a0 - a4;
    let e2 = a2 + a6;
    let e3 = a2 - a6;
    let E0 = e0 + e2;
    let E1 = e1 + vec2<f32>(e3.y, -e3.x);
    let E2 = e0 - e2;
    let E3 = e1 + vec2<f32>(-e3.y, e3.x);

    let f0 = a1 + a5;
    let f1 = a1 - a5;
    let f2 = a3 + a7;
    let f3 = a3 - a7;
    let O0 = f0 + f2;
    let O1 = f1 + vec2<f32>(f3.y, -f3.x);
    let O2 = f0 - f2;
    let O3 = f1 + vec2<f32>(-f3.y, f3.x);

    let p0 = O0;
    let p1 = vec2<f32>(sqrt1_2 * (O1.x + O1.y), sqrt1_2 * (O1.y - O1.x));
    let p2 = vec2<f32>(O2.y, -O2.x);
    let p3 = vec2<f32>(sqrt1_2 * (O3.y - O3.x), -sqrt1_2 * (O3.x + O3.y));

    let dst = reverseRest(j) * 8u;
    sm[dst] = E0 + p0;
    sm[dst + 1u] = E1 + p1;
    sm[dst + 2u] = E2 + p2;
    sm[dst + 3u] = E3 + p3;
    sm[dst + 4u] = E0 - p0;
    sm[dst + 5u] = E1 - p1;
    sm[dst + 6u] = E2 - p2;
    sm[dst + 7u] = E3 - p3;
  }
  workgroupBarrier();

  for (var len = 64u; len <= packedWindowSize; len *= 8u) {
    let quarter = len / 8u;
    let twiddleStep = packedWindowSize / len;

    for (var j = t; j < butterflyCount; j += threadCount) {
      let k = j % quarter;
      let block = j / quarter;
      let base = block * len + k;
      let tw = k * twiddleStep;

      let a0 = getResult(base);
      let a1 = mul(getResult(base + quarter), getFftTwiddle(tw));
      let a2 = mul(getResult(base + 2u * quarter), getFftTwiddle(2u * tw));
      let a3 = mul(getResult(base + 3u * quarter), getFftTwiddle(3u * tw));
      let a4 = mul(getResult(base + 4u * quarter), getFftTwiddle(4u * tw));
      let a5 = mul(getResult(base + 5u * quarter), getFftTwiddle(5u * tw));
      let a6 = mul(getResult(base + 6u * quarter), getFftTwiddle(6u * tw));
      let a7 = mul(getResult(base + 7u * quarter), getFftTwiddle(7u * tw));

      let e0 = a0 + a4;
      let e1 = a0 - a4;
      let e2 = a2 + a6;
      let e3 = a2 - a6;
      let E0 = e0 + e2;
      let E1 = e1 + vec2<f32>(e3.y, -e3.x);
      let E2 = e0 - e2;
      let E3 = e1 + vec2<f32>(-e3.y, e3.x);

      let f0 = a1 + a5;
      let f1 = a1 - a5;
      let f2 = a3 + a7;
      let f3 = a3 - a7;
      let O0 = f0 + f2;
      let O1 = f1 + vec2<f32>(f3.y, -f3.x);
      let O2 = f0 - f2;
      let O3 = f1 + vec2<f32>(-f3.y, f3.x);

      let p0 = O0;
      let p1 = vec2<f32>(
        sqrt1_2 * (O1.x + O1.y),
        sqrt1_2 * (O1.y - O1.x),
      );
      let p2 = vec2<f32>(O2.y, -O2.x);
      let p3 = vec2<f32>(
        sqrt1_2 * (O3.y - O3.x),
        -sqrt1_2 * (O3.x + O3.y),
      );

      sm[base] = E0 + p0;
      sm[base + quarter] = E1 + p1;
      sm[base + 2u * quarter] = E2 + p2;
      sm[base + 3u * quarter] = E3 + p3;
      sm[base + 4u * quarter] = E0 - p0;
      sm[base + 5u * quarter] = E1 - p1;
      sm[base + 6u * quarter] = E2 - p2;
      sm[base + 7u * quarter] = E3 - p3;
    }
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
