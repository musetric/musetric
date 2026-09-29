import { pitchParamsStruct } from './paramsStruct.wgsl.js';

export const periodicityShader = `
${pitchParamsStruct}

@group(0) @binding(0) var<storage, read> autocorrelation: array<f32>;
@group(0) @binding(1) var<storage, read> windowCorrelation: array<f32>;
@group(0) @binding(2) var<storage, read_write> periodicity: array<f32>;
@group(0) @binding(3) var<uniform> params: PitchParams;

@compute @workgroup_size(64)
fn correlate(@builtin(global_invocation_id) gid: vec3<u32>) {
  let lagIndex = gid.x;
  let slotIndex = gid.y;
  if (lagIndex >= params.lagCount || slotIndex >= params.slotCount) {
    return;
  }
  let base = slotIndex * (params.fftSize + 2u);
  let energy = autocorrelation[base];
  let lag = params.minimumLag + lagIndex;
  let windowShare = windowCorrelation[lagIndex];
  var value = 0.0;
  if (lag < params.windowSize && energy > 1.0e-12 && windowShare > 1.0e-6) {
    value = clamp(autocorrelation[base + lag] / energy / windowShare, -1.0, 1.0);
  }
  periodicity[slotIndex * params.lagCount + lagIndex] = value;
}
`;
