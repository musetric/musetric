export const cqtProjectShader = `
struct Params {
  frameCount: u32,
  binStart: u32,
  binCount: u32,
  fftSize: u32,
  outputBins: u32,
  outputKind: u32,
};

@group(0) @binding(0) var<storage, read> spectrum: array<f32>;
@group(0) @binding(1) var<storage, read> rowOffsets: array<u32>;
@group(0) @binding(2) var<storage, read> fftBins: array<u32>;
@group(0) @binding(3) var<storage, read> coefficients: array<f32>;
@group(0) @binding(4) var<storage, read_write> output: array<f32>;
@group(0) @binding(5) var<uniform> params: Params;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let localBin = id.x;
  let frameIndex = id.y;
  if (localBin >= params.binCount || frameIndex >= params.frameCount) {
    return;
  }
  let globalBin = params.binStart + localBin;
  let coefficientStart = rowOffsets[globalBin];
  let coefficientEnd = rowOffsets[globalBin + 1u];
  let spectrumStride = params.fftSize + 2u;
  let spectrumOffset = frameIndex * spectrumStride;
  var sum = vec2<f32>(0.0, 0.0);
  for (var coefficientIndex = coefficientStart;
       coefficientIndex < coefficientEnd;
       coefficientIndex++) {
    let fftBin = fftBins[coefficientIndex];
    let spectrumIndex = spectrumOffset + 2u * fftBin;
    let coefficientIndex2 = 2u * coefficientIndex;
    let coefficient = vec2<f32>(
      coefficients[coefficientIndex2],
      coefficients[coefficientIndex2 + 1u],
    );
    let sample = vec2<f32>(
      spectrum[spectrumIndex],
      spectrum[spectrumIndex + 1u],
    );
    sum += vec2<f32>(
      coefficient.x * sample.x - coefficient.y * sample.y,
      coefficient.x * sample.y + coefficient.y * sample.x,
    );
  }
  let magnitude = sqrt(sum.x * sum.x + sum.y * sum.y);
  let outputIndex = frameIndex * params.outputBins + globalBin;
  if (params.outputKind == 0u) {
    output[outputIndex] = magnitude;
    return;
  }
  output[outputIndex] = log(magnitude + 0.000001);
}
`;
