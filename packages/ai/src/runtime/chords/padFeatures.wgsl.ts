export const chordPadFeaturesShader = `
override frameCount: u32 = 0u;
override outputFloatCount: u32 = 0u;
override binCount: u32 = 144u;

@group(0) @binding(0) var<storage, read> features: array<f32>;
@group(0) @binding(1) var<storage, read_write> windows: array<f32>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let outputIndex = id.x;
  if (outputIndex >= outputFloatCount) {
    return;
  }
  let frameIndex = outputIndex / binCount;
  if (frameIndex < frameCount) {
    windows[outputIndex] = features[outputIndex];
    return;
  }
  windows[outputIndex] = 0.0;
}
`;
