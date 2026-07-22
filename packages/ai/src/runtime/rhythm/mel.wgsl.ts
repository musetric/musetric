export const rhythmMelShader = `
override nFft: u32;
override bins: u32;
override melBins: u32;
override frames: u32;
override fftScale: f32;
override logMultiplier: f32;

@group(0) @binding(0) var<storage, read> wave: array<f32>;
@group(0) @binding(1) var<storage, read> filterbank: array<f32>;
@group(0) @binding(2) var<storage, read_write> spect: array<f32>;

fn log1p(x: f32) -> f32 {
  let shifted = 1.0 + x;
  if (shifted == 1.0) {
    return x;
  }
  return log(shifted) * x / (shifted - 1.0);
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let mel = id.x;
  let frame = id.y;
  if (mel >= melBins || frame >= frames) {
    return;
  }
  let base = frame * (nFft + 2u);
  var total = 0.0;
  for (var bin = 0u; bin < bins; bin = bin + 1u) {
    let real = wave[base + 2u * bin];
    let imaginary = wave[base + 2u * bin + 1u];
    let magnitude = sqrt(real * real + imaginary * imaginary) * fftScale;
    total = total + magnitude * filterbank[bin * melBins + mel];
  }
  spect[frame * melBins + mel] = log1p(logMultiplier * total);
}
`;
