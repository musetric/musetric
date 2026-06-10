export const multiPassUnpackShader = `
override packedWindowSize: u32 = 2560u;
override finalReadBufferIndex: u32 = 0u;

const threadCount: u32 = 64u;

struct Params {
  windowSize: u32,
  windowCount: u32,
};

@group(0) @binding(0) var<storage, read_write> signal: array<f32>;
@group(0) @binding(1) var<storage, read> scratch0: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> scratch1: array<vec2<f32>>;
@group(0) @binding(3) var<uniform> params: Params;

fn readResult(windowIndex: u32, index: u32) -> vec2<f32> {
  let offset = packedWindowSize * windowIndex + index;
  if (finalReadBufferIndex == 0u) {
    return scratch0[offset];
  }
  return scratch1[offset];
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

  let i = workgroupId.y * threadCount + localId.x;
  if (i >= packedWindowSize) {
    return;
  }

  let signalOffset = params.windowSize * windowIndex;
  let scale = 1.0 / f32(packedWindowSize);
  let value = readResult(windowIndex, i) * scale;
  signal[signalOffset + 2u * i] = value.x;
  signal[signalOffset + 2u * i + 1u] = value.y;
}
`;
