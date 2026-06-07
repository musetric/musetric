export const transformShader = `
override packedWindowSize: u32 = 2048u;
override log2PackedWindowSize: u32 = 11u;

struct Params {
  windowSize: u32,
  windowCount: u32,
};

var<workgroup> smReal0: array<f32, packedWindowSize>;
var<workgroup> smImag0: array<f32, packedWindowSize>;
var<workgroup> smReal1: array<f32, packedWindowSize>;
var<workgroup> smImag1: array<f32, packedWindowSize>;

@group(0) @binding(0) var<storage, read_write> signalReal: array<f32>;
@group(0) @binding(1) var<storage, read_write> signalImag: array<f32>;
@group(0) @binding(2) var<storage, read> fftTrigTable: array<f32>;
@group(0) @binding(3) var<storage, read> r2cTrigTable: array<f32>;
@group(0) @binding(4) var<uniform> params: Params;

fn getResult(index: u32) -> vec2<f32> {
  if ((log2PackedWindowSize & 1u) == 0u) {
    return vec2<f32>(smReal0[index], smImag0[index]);
  }
  return vec2<f32>(smReal1[index], smImag1[index]);
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
    let sampleIndex = i * 2u;
    smReal0[i] = signalReal[windowOffset + sampleIndex];
    smImag0[i] = signalReal[windowOffset + sampleIndex + 1u];
  }
  workgroupBarrier();

  let halfPackedWindowSize = packedWindowSize >> 1u;
  for (var stage: u32 = 0u; stage < log2PackedWindowSize; stage++) {
    let stride = 1u << stage;
    let evenStage = (stage & 1u) == 0u;

    for (var j = t; j < halfPackedWindowSize; j += 64u) {
      let k = j % stride;
      let block = j / stride;
      let aIndex = block * stride + k;
      let bIndex = aIndex + halfPackedWindowSize;
      let outEven = block * (stride << 1u) + k;
      let outOdd = outEven + stride;
      let trigIndex = k * (halfPackedWindowSize / stride);
      let twiddleReal = fftTrigTable[2u * trigIndex];
      let twiddleImag = -fftTrigTable[2u * trigIndex + 1u];

      var aReal: f32;
      var aImag: f32;
      var bReal: f32;
      var bImag: f32;
      if (evenStage) {
        aReal = smReal0[aIndex];
        aImag = smImag0[aIndex];
        bReal = smReal0[bIndex];
        bImag = smImag0[bIndex];
      } else {
        aReal = smReal1[aIndex];
        aImag = smImag1[aIndex];
        bReal = smReal1[bIndex];
        bImag = smImag1[bIndex];
      }

      let productReal = bReal * twiddleReal - bImag * twiddleImag;
      let productImag = bReal * twiddleImag + bImag * twiddleReal;

      if (evenStage) {
        smReal1[outEven] = aReal + productReal;
        smImag1[outEven] = aImag + productImag;
        smReal1[outOdd] = aReal - productReal;
        smImag1[outOdd] = aImag - productImag;
      } else {
        smReal0[outEven] = aReal + productReal;
        smImag0[outEven] = aImag + productImag;
        smReal0[outOdd] = aReal - productReal;
        smImag0[outOdd] = aImag - productImag;
      }
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
