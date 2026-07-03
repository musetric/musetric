export const vertexShader = `
struct VertexOutput {
  @builtin(position) position : vec4f,
  @location(0) uv : vec2f,
};

@vertex
fn main(@builtin(vertex_index) vertexIndex : u32) -> VertexOutput {
  var pos = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0)
  );
  let p = pos[vertexIndex];
  var out : VertexOutput;
  out.position = vec4f(p, 0.0, 1.0);
  out.uv = (p + vec2f(1.0, 1.0)) * 0.5;
  return out;
}
`;
