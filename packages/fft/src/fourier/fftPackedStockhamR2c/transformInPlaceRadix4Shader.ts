export const transformInPlaceRadix4Shader = `
override packedWindowSize: u32 = 4096u;
override log2PackedWindowSize: u32 = 12u;

struct Params {
  windowSize: u32,
  windowCount: u32,
};

var<workgroup> smReal: array<f32, packedWindowSize>;
var<workgroup> smImag: array<f32, packedWindowSize>;

@group(0) @binding(0) var<storage, read_write> signalReal: array<f32>;
@group(0) @binding(1) var<storage, read_write> signalImag: array<f32>;
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

fn writeBin(windowOffset: u32, k: u32, value: vec2<f32>) {
  signalReal[windowOffset + k] = value.x;
  signalImag[windowOffset + k] = value.y;
}

@compute @workgroup_size(64)
fn main(
  @builtin(workgroup_id) workgroupId: vec3<u32>,
  @builtin(local_invocation_id) localId: vec3<u32>,
) {
  let windowIndex = workgroupId.x;
  if (windowIndex >= params.windowCount) {
    return;
  }

  let t = localId.x;
  let windowOffset = params.windowSize * windowIndex;

  for (var i = t; i < packedWindowSize; i += 64u) {
    let reversedIndex = reverseRadix4(i);
    let sampleIndex = i * 2u;
    smReal[reversedIndex] = signalReal[windowOffset + sampleIndex];
    smImag[reversedIndex] = signalReal[windowOffset + sampleIndex + 1u];
  }
  workgroupBarrier();

  for (var len = 4u; len <= packedWindowSize; len *= 4u) {
    let quarter = len / 4u;
    let twiddleStep = packedWindowSize / len;
    let butterflyCount = packedWindowSize / 4u;

    for (var j = t; j < butterflyCount; j += 64u) {
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

  for (var k = t; k <= packedWindowSize; k += 64u) {
    if (k == 0u) {
      let z0 = getResult(0u);
      writeBin(windowOffset, 0u, vec2<f32>(z0.x + z0.y, 0.0));
    } else if (k == packedWindowSize) {
      let z0 = getResult(0u);
      writeBin(windowOffset, k, vec2<f32>(z0.x - z0.y, 0.0));
    } else {
      let value = getResult(k);
      let mirrorValue = getResult(packedWindowSize - k);
      writeBin(windowOffset, k, r2cBin(k, value, mirrorValue));
    }
  }
}
`;
