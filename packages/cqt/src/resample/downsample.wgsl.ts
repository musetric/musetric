export const downsampleShader = `
struct Params {
  inputCount: u32,
  outputCount: u32,
  tapCount: u32,
  delay: u32,
  gain: f32,
};

@group(0) @binding(0) var<storage, read> input: array<f32>;
@group(0) @binding(1) var<storage, read_write> output: array<f32>;
@group(0) @binding(2) var<storage, read> halfCoefficients: array<f32>;
@group(0) @binding(3) var<uniform> params: Params;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let outputIndex = id.x;
  if (outputIndex >= params.outputCount) {
    return;
  }

  let center = i32(outputIndex * 2u);
  let delay = i32(params.delay);
  var value = 0.0;
  for (var tap = 0u; tap < params.tapCount; tap++) {
    let sourceIndex = center + i32(tap) - delay;
    if (sourceIndex < 0 || sourceIndex >= i32(params.inputCount)) {
      continue;
    }
    let distance = abs(i32(tap) - delay);
    value += input[u32(sourceIndex)] * halfCoefficients[u32(distance)];
  }
  output[outputIndex] = value * params.gain;
}
`;
