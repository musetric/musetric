import { pitchParamsStruct } from './paramsStruct.wgsl.js';
import { pitchDecodedStruct } from './slots.wgsl.js';

export const projectShader = `
${pitchParamsStruct}
${pitchDecodedStruct}

@group(0) @binding(0) var<storage, read> decoded: array<PitchDecoded>;
@group(0) @binding(1) var<storage, read_write> line: array<f32>;
@group(0) @binding(2) var<uniform> params: PitchParams;

@compute @workgroup_size(64)
fn project(@builtin(global_invocation_id) gid: vec3<u32>) {
  let screen = gid.x;
  if (screen >= params.windowCount) {
    return;
  }
  let column = params.baseColumn + i32(screen);
  let frame = i32(round(f32(column) * params.columnStep / f32(params.hop)));
  var value = 0.0;
  if (frame >= 0 && frame < params.shownFrames) {
    let entry = decoded[u32(frame) % params.ringFrames];
    if (entry.frame == frame) {
      value = entry.frequency;
    }
  }
  line[(params.baseSlot + screen) % params.windowCount] = value;
}
`;
