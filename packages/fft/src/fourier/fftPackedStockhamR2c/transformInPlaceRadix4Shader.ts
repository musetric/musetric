export const transformInPlaceRadix4Shader = `
override packedWindowSize: u32 = 4096u;
override log2PackedWindowSize: u32 = 12u;
override inPlace: u32 = 1u;
override threadCount: u32 = 64u;

struct Params {
  windowSize: u32,
  windowCount: u32,
  batchOffset: u32,
};

var<workgroup> smReal: array<f32, packedWindowSize>;
var<workgroup> smImag: array<f32, packedWindowSize>;

@group(0) @binding(0) var<storage, read> wave: array<f32>;
@group(0) @binding(1) var<storage, read_write> spectrum: array<f32>;
@group(0) @binding(2) var<storage, read> fftTrigTable: array<f32>;
@group(0) @binding(3) var<storage, read> r2cTrigTable: array<f32>;
@group(0) @binding(4) var<uniform> params: Params;

fn reverseRadix4(index: u32) -> u32 {
  var value = index;
  var result = 0u;
  for (var i = 0u; i < log2PackedWindowSize / 2u; i++) {
    result = result * 4u + value % 4u;
    value = value / 4u;
  }
  return result;
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
  return vec2<f32>(smReal[index], smImag[index]);
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

  for (var i = t; i < packedWindowSize; i += threadCount) {
    let reversedIndex = reverseRadix4(i);
    let sampleIndex = i * 2u;
    smReal[reversedIndex] = readInput(inputOffset, sampleIndex);
    smImag[reversedIndex] = readInput(inputOffset, sampleIndex + 1u);
  }
  workgroupBarrier();

  for (var len = 4u; len <= packedWindowSize; len *= 4u) {
    let quarter = len / 4u;
    let twiddleStep = packedWindowSize / len;
    let butterflyCount = packedWindowSize / 4u;

    for (var j = t; j < butterflyCount; j += threadCount) {
      let k = j % quarter;
      let block = j / quarter;
      let i0 = block * len + k;
      let i1 = i0 + quarter;
      let i2 = i1 + quarter;
      let i3 = i2 + quarter;

      let a0 = getResult(i0);
      let a1 = mul(getResult(i1), getFftTwiddle(k * twiddleStep));
      let a2 = mul(getResult(i2), getFftTwiddle(2u * k * twiddleStep));
      let a3 = mul(getResult(i3), getFftTwiddle(3u * k * twiddleStep));

      let sum02 = a0 + a2;
      let diff02 = a0 - a2;
      let sum13 = a1 + a3;
      let diff13 = a1 - a3;
      let minusIDiff13 = vec2<f32>(diff13.y, -diff13.x);
      let plusIDiff13 = vec2<f32>(-diff13.y, diff13.x);

      let out0 = sum02 + sum13;
      let out1 = diff02 + minusIDiff13;
      let out2 = sum02 - sum13;
      let out3 = diff02 + plusIDiff13;

      smReal[i0] = out0.x;
      smImag[i0] = out0.y;
      smReal[i1] = out1.x;
      smImag[i1] = out1.y;
      smReal[i2] = out2.x;
      smImag[i2] = out2.y;
      smReal[i3] = out3.x;
      smImag[i3] = out3.y;
    }
    workgroupBarrier();
  }

  for (var k = t; k <= packedWindowSize; k += threadCount) {
    if (k == 0u) {
      let z0 = getResult(0u);
      writeBin(spectrumOffset, 0u, vec2<f32>(z0.x + z0.y, 0.0));
    } else if (k == packedWindowSize) {
      let z0 = getResult(0u);
      writeBin(spectrumOffset, k, vec2<f32>(z0.x - z0.y, 0.0));
    } else {
      let value = getResult(k);
      let mirrorValue = getResult(packedWindowSize - k);
      writeBin(spectrumOffset, k, r2cBin(k, value, mirrorValue));
    }
  }
}
`;
