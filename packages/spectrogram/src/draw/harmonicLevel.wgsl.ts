export const harmonicLevelWgsl = `
fn rowAtFrequency(frequency: f32, height: u32) -> f32 {
  let ratio = (log(frequency) - drawParams.frequencyMap.x) /
    drawParams.frequencyMap.y;
  return (1.0 - ratio) * f32(height - 1u);
}

fn harmonicLevel(slot: u32, layer: u32, frequency: f32, height: u32) -> f32 {
  let rowsPerCent = f32(height - 1u) * log(2.0) /
    (1200.0 * drawParams.frequencyMap.y);
  let center = rowAtFrequency(frequency, height);
  let reach = drawParams.harmonicTuning.z * rowsPerCent;
  let lastRow = f32(height - 1u);
  let first = u32(clamp(floor(center - reach), 0.0, lastRow));
  let last = u32(clamp(ceil(center + reach), 0.0, lastRow));
  var level = 0.0;
  for (var row = first; row <= last; row += 1u) {
    level = max(
      level,
      textureLoad(spectrogramTextures, vec2u(slot, row), layer, 0).g,
    );
  }
  return level;
}

fn peakHarmonicLevel(fundamental: f32, slot: u32, layer: u32, height: u32) -> f32 {
  let minFrequency = exp(drawParams.frequencyMap.x);
  var peak = 0.0;
  for (
    var harmonic = 1u;
    f32(harmonic) * fundamental <= drawParams.harmonicTuning.y;
    harmonic += 1u
  ) {
    let frequency = f32(harmonic) * fundamental;
    if (frequency < minFrequency) {
      continue;
    }
    peak = max(peak, harmonicLevel(slot, layer, frequency, height));
  }
  return peak;
}
`;
