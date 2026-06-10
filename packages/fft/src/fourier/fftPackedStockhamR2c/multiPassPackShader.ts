export const multiPassPackShader = `
override packedWindowSize: u32 = 2560u;
override finalReadBufferIndex: u32 = 0u;

const threadCount: u32 = 64u;

struct Params {
  windowSize: u32,
  windowCount: u32,
};

@group(0) @binding(0) var<storage, read_write> spectrum: array<f32>;
@group(0) @binding(1) var<storage, read> scratch0: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> scratch1: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read> r2cTrigTable: array<f32>;
@group(0) @binding(4) var<uniform> params: Params;

fn readResult(windowIndex: u32, index: u32) -> vec2<f32> {
  let offset = packedWindowSize * windowIndex + index;
  if (finalReadBufferIndex == 0u) {
    return scratch0[offset];
  }
  return scratch1[offset];
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

fn complexStride() -> u32 {
  return params.windowSize + 2u;
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
  let windowIndex = workgroupId.x;
  if (windowIndex >= params.windowCount) {
    return;
  }

  let k = workgroupId.y * threadCount + localId.x;
  if (k > packedWindowSize) {
    return;
  }

  let spectrumOffset = complexStride() * windowIndex;
  if (k == 0u) {
    let z0 = readResult(windowIndex, 0u);
    writeBin(spectrumOffset, 0u, vec2<f32>(z0.x + z0.y, 0.0));
    writeBin(spectrumOffset, packedWindowSize, vec2<f32>(z0.x - z0.y, 0.0));
  } else if (k < packedWindowSize) {
    let value = readResult(windowIndex, k);
    let mirrorValue = readResult(windowIndex, packedWindowSize - k);
    writeBin(spectrumOffset, k, r2cBin(k, value, mirrorValue));
  }
}
`;
