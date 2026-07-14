export const chordSmoothArgmaxShader = `
override frameCount: u32 = 0u;
override seqLen: u32 = 108u;
override chordCount: u32 = 170u;
override smoothingRadius: i32 = 4;

@group(0) @binding(0) var<storage, read> logits: array<f32>;
@group(0) @binding(1) var<storage, read_write> indices: array<u32>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let frameIndex = id.x;
  if (frameIndex >= frameCount) {
    return;
  }
  let windowIndex = frameIndex / seqLen;
  let localFrame = i32(frameIndex % seqLen);
  var bestIndex = 0u;
  var bestValue = -3.402823466e+38;
  for (var chordIndex = 0u; chordIndex < chordCount; chordIndex++) {
    var total = 0.0;
    for (var offset = -smoothingRadius; offset <= smoothingRadius; offset++) {
      let neighbor = localFrame + offset;
      if (neighbor < 0 || neighbor >= i32(seqLen)) {
        continue;
      }
      let index = (windowIndex * seqLen + u32(neighbor)) * chordCount +
        chordIndex;
      total += logits[index];
    }
    if (total > bestValue) {
      bestValue = total;
      bestIndex = chordIndex;
    }
  }
  indices[frameIndex] = bestIndex;
}
`;
