export const pitchSalienceFunctions = `
const prominenceProbeRatio = 1.041243772;

const harmonicWeights = array<f32, 11>(
  0.0, 1.0, 0.5, 0.333333333, 0.25, 0.2,
  0.166666667, 0.142857143, 0.125, 0.111111111, 0.1,
);

fn whitenedAt(slotIndex: u32, frequency: f32) -> f32 {
  let rawIndex = frequency / binFrequency();
  let lowerIndex = u32(floor(rawIndex));
  if (frequency <= 0.0 || lowerIndex + 1u >= params.spectrumBins) {
    return 0.0;
  }
  let base = slotIndex * params.spectrumBins;
  return mix(
    whitened[base + lowerIndex],
    whitened[base + lowerIndex + 1u],
    fract(rawIndex),
  );
}

fn loudnessAt(slotIndex: u32, frequency: f32) -> f32 {
  let center = whitenedAt(slotIndex, frequency);
  let lower = whitenedAt(slotIndex, frequency / prominenceProbeRatio);
  let upper = whitenedAt(slotIndex, frequency * prominenceProbeRatio);
  let prominence = max(center - 0.5 * max(lower, upper), 0.0);
  if (prominence <= 0.0) {
    return 0.0;
  }
  return pow(prominence, params.loudnessExponent);
}

fn combSalience(slotIndex: u32, frequency: f32) -> f32 {
  var weighted = 0.0;
  var antiWeighted = 0.0;
  var totalWeight = 0.0;
  var fundamental = 0.0;
  for (var harmonic = 1u; harmonic <= params.harmonicCount; harmonic += 1u) {
    let weight = harmonicWeights[harmonic];
    let order = f32(harmonic);
    totalWeight += weight;
    let loudness = loudnessAt(slotIndex, frequency * order);
    weighted += loudness * weight;
    if (harmonic == 1u) {
      fundamental = loudness;
    }
    let anti =
      0.5 * loudnessAt(slotIndex, frequency * (order + 0.5)) +
      0.25 * loudnessAt(slotIndex, frequency * (order + 0.333333333)) +
      0.25 * loudnessAt(slotIndex, frequency * (order + 0.666666667));
    antiWeighted += anti * weight;
  }
  if (totalWeight <= 0.0) {
    return 0.0;
  }
  return (weighted - params.antiWeight * antiWeighted) / totalWeight +
    params.fundamentalWeight * fundamental;
}

fn periodicityAt(slotIndex: u32, frequency: f32) -> f32 {
  let rawIndex = params.sampleRate / frequency - f32(params.minimumLag);
  if (rawIndex < 0.0) {
    return 0.0;
  }
  let lowerIndex = u32(floor(rawIndex));
  if (lowerIndex + 1u >= params.lagCount) {
    return 0.0;
  }
  let base = slotIndex * params.lagCount;
  return mix(
    periodicity[base + lowerIndex],
    periodicity[base + lowerIndex + 1u],
    fract(rawIndex),
  );
}

fn candidateSalience(slotIndex: u32, frequency: f32, gate: f32) -> f32 {
  let spectral = combSalience(slotIndex, frequency);
  if (spectral <= 0.0) {
    return 0.0;
  }
  let period = clamp(periodicityAt(slotIndex, frequency), 0.0, 1.0);
  let agreement = params.periodicityFloor + (1.0 - params.periodicityFloor) * period;
  let neutral = params.periodicityFloor + (1.0 - params.periodicityFloor) * 0.5;
  let factor = min(agreement / neutral, params.agreementBoostCap);
  return spectral * factor * gate;
}
`;
