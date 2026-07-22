export const rhythmWindowsShader = `
override melBins: u32;
override frames: i32;
override windowFrames: u32;
override windowCount: u32;

@group(0) @binding(0) var<storage, read> spect: array<f32>;
@group(0) @binding(1) var<storage, read> starts: array<i32>;
@group(0) @binding(2) var<storage, read_write> windows: array<f32>;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let mel = id.x;
  let slot = id.y;
  if (mel >= melBins || slot >= windowFrames * windowCount) {
    return;
  }
  let window = slot / windowFrames;
  let offset = slot % windowFrames;
  let frame = starts[window] + i32(offset);
  var value = 0.0;
  if (frame >= 0i && frame < frames) {
    value = spect[u32(frame) * melBins + mel];
  }
  windows[slot * melBins + mel] = value;
}
`;
