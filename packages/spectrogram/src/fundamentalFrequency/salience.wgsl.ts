import { pitchParamsStruct } from './paramsStruct.wgsl.js';

export const pitchCandidateFunctions = `
const maxCandidateCount = 512u;

fn frequencyAtCandidate(candidate: u32) -> f32 {
  return params.minimumFrequency *
    exp2(f32(candidate) * params.candidateStepCents / 1200.0);
}

fn binFrequency() -> f32 {
  return params.sampleRate / f32(params.fftSize);
}
`;

const pitchSalienceFunctions = `
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

export const salienceShader = `
${pitchParamsStruct}

@group(0) @binding(0) var<storage, read> whitened: array<f32>;
@group(0) @binding(1) var<storage, read> levels: array<f32>;
@group(0) @binding(2) var<storage, read> periodicity: array<f32>;
@group(0) @binding(3) var<storage, read_write> salienceValues: array<f32>;
@group(0) @binding(4) var<uniform> params: PitchParams;
${pitchCandidateFunctions}
${pitchSalienceFunctions}
@compute @workgroup_size(64)
fn salience(@builtin(global_invocation_id) id: vec3<u32>) {
  let candidate = id.x;
  let slotIndex = id.y;
  let candidateCount = min(params.candidateCount, maxCandidateCount);
  if (slotIndex >= params.slotCount || candidate >= candidateCount) {
    return;
  }
  let level = levels[slotIndex];
  let gate = clamp((level - params.levelFloorDb) / max(params.levelRangeDb, 0.001), 0.0, 1.0);
  var value = 0.0;
  if (gate > 0.0) {
    value = candidateSalience(slotIndex, frequencyAtCandidate(candidate), gate);
  }
  salienceValues[slotIndex * candidateCount + candidate] = value;
}
`;
