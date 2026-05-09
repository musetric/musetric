struct Colors {
  foreground : vec4f,
  background : vec4f,
};

@group(0) @binding(0) var<uniform> colors : Colors;
@group(0) @binding(1) var valueSampler : sampler;
@group(0) @binding(2) var columnTexture : texture_2d<f32>;

@fragment
fn main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let intensity = textureSample(columnTexture, valueSampler, vec2f(uv.x, 1.0 - uv.y)).r;
  let color = mix(colors.background.xyz, colors.foreground.xyz, intensity);
  return vec4f(color, 1.0);
}
