import { fundamentalFrequencyParamsStruct } from './paramsStruct.wgsl.js';

export const shader = `
${fundamentalFrequencyParamsStruct}

@group(0) @binding(0) var<storage, read> signal: array<f32>;
@group(0) @binding(1) var<storage, read> periodicity: array<f32>;
@group(0) @binding(2) var<storage, read_write> lattice: array<vec2<f32>>;
@group(0) @binding(3) var<uniform> params: FundamentalFrequencyParams;

const workgroupWidth = 64u;
const maxLatticeCount = 8u;
const maxCandidateCount = 512u;

const harmonicWeights = array<f32, 11>(
  0.0,
  1.0,
  0.5,
  0.333333333,
  0.25,
  0.2,
  0.166666667,
  0.142857143,
  0.125,
  0.111111111,
  0.1,
);

const prominenceProbeRatio = 1.041243772;

var<workgroup> workgroupSalience: array<f32, 512>;

fn frequencyAtCandidate(candidate: u32) -> f32 {
  return params.minimumFrequency *
    exp2(f32(candidate) * params.candidateStepCents / 1200.0);
}

fn sampleIntensity(windowIndex: u32, frequency: f32) -> f32 {
  let nyquistFrequency = params.sampleRate * 0.5;
  if (frequency <= 0.0 || frequency >= nyquistFrequency) {
    return 0.0;
  }

  let rawIndex = (frequency / params.sampleRate) * f32(params.windowSize);
  let lowerIndex = u32(floor(rawIndex));
  if (lowerIndex >= params.halfSize) {
    return 0.0;
  }

  let upperIndex = min(lowerIndex + 1u, params.halfSize - 1u);
  let blend = fract(rawIndex);
  let offset = windowIndex * params.halfSize;
  let lowerIntensity = signal[offset + lowerIndex];
  let upperIntensity = signal[offset + upperIndex];
  return mix(lowerIntensity, upperIntensity, blend);
}

fn spectralProminence(windowIndex: u32, frequency: f32) -> f32 {
  let center = sampleIntensity(windowIndex, frequency);
  let lower = sampleIntensity(windowIndex, frequency / prominenceProbeRatio);
  let upper = sampleIntensity(windowIndex, frequency * prominenceProbeRatio);
  let localFloor = max(lower, upper) * 0.5;
  return max(center - localFloor, 0.0);
}

fn loudnessAt(windowIndex: u32, frequency: f32) -> f32 {
  let prominence = spectralProminence(windowIndex, frequency);
  if (prominence <= 0.0) {
    return 0.0;
  }
  return pow(prominence, params.loudnessExponent);
}

fn harmonicSalience(windowIndex: u32, frequency: f32) -> f32 {
  var weighted = 0.0;
  var antiWeighted = 0.0;
  var totalWeight = 0.0;
  var fundamentalLoudness = 0.0;
  for (var harmonic = 1u; harmonic <= params.harmonicCount; harmonic += 1u) {
    let weight = harmonicWeights[harmonic];
    totalWeight += weight;
    let loudness = loudnessAt(windowIndex, frequency * f32(harmonic));
    weighted += loudness * weight;
    if (harmonic == 1u) {
      fundamentalLoudness = loudness;
    }
    // Energy between the comb teeth. The half-harmonic tap lands on the
    // true fundamental's odd harmonics when the candidate is an octave up;
    // the third taps land on true harmonics when it is a twelfth up (3x).
    let anti =
      0.5 * loudnessAt(windowIndex, frequency * (f32(harmonic) + 0.5)) +
      0.25 * loudnessAt(windowIndex, frequency * (f32(harmonic) + 0.333333333)) +
      0.25 * loudnessAt(windowIndex, frequency * (f32(harmonic) + 0.666666667));
    antiWeighted += anti * weight;
  }
  if (totalWeight <= 0.0) {
    return 0.0;
  }
  return (weighted - params.antiWeight * antiWeighted) / totalWeight +
    params.fundamentalWeight * fundamentalLoudness;
}

fn periodicityAt(windowIndex: u32, frequency: f32) -> f32 {
  if (params.lagCount == 0u || frequency <= 0.0 || params.lagStep <= 0.0) {
    return 0.0;
  }

  let lag = params.sampleRate / frequency;
  let rawIndex = (lag - params.minimumLag) / params.lagStep;
  if (rawIndex < 0.0) {
    return 0.0;
  }

  let lowerIndex = u32(floor(rawIndex));
  if (lowerIndex >= params.lagCount) {
    return 0.0;
  }

  let upperIndex = min(lowerIndex + 1u, params.lagCount - 1u);
  let blend = fract(rawIndex);
  let offset = windowIndex * params.lagCount;
  let lower = periodicity[offset + lowerIndex];
  let upper = periodicity[offset + upperIndex];
  return mix(lower, upper, blend);
}

fn agreementSalience(windowIndex: u32, frequency: f32) -> f32 {
  let spectral = harmonicSalience(windowIndex, frequency);
  if (spectral <= 0.0) {
    return 0.0;
  }

  let period = clamp(periodicityAt(windowIndex, frequency), 0.0, 1.0);
  let periodGate = pow(period, params.agreementPower);
  let agreement =
    params.periodicityFloor + (1.0 - params.periodicityFloor) * periodGate;
  let neutral =
    params.periodicityFloor + (1.0 - params.periodicityFloor) * 0.5;
  let factor = min(agreement / max(neutral, 0.000001), params.agreementBoostCap);
  return spectral * factor;
}

@compute @workgroup_size(64)
fn observe(
  @builtin(workgroup_id) workgroupId: vec3<u32>,
  @builtin(local_invocation_id) localId: vec3<u32>,
) {
  let localWindowIndex = workgroupId.x;
  let threadIndex = localId.x;
  if (localWindowIndex >= params.columnCount) {
    return;
  }
  let windowIndex = (params.slotOffset + localWindowIndex) % params.windowCount;
  let candidateCount = min(params.candidateCount, maxCandidateCount);
  let latticeCount = min(params.latticeCount, maxLatticeCount);

  for (
    var candidate = threadIndex;
    candidate < candidateCount;
    candidate += workgroupWidth
  ) {
    workgroupSalience[candidate] =
      agreementSalience(windowIndex, frequencyAtCandidate(candidate));
  }
  workgroupBarrier();

  if (threadIndex != 0u) {
    return;
  }

  let separationCandidates =
    u32(max(1.0, params.peakSeparationCents / params.candidateStepCents));
  var pickedCandidate = array<u32, 8>(0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u);
  let latticeBase = windowIndex * params.latticeCount;

  var poolFilled = 0u;
  for (var picked = 0u; picked < latticeCount; picked += 1u) {
    var bestScore = 0.0;
    var bestCandidate = candidateCount;
    for (var candidate = 0u; candidate < candidateCount; candidate += 1u) {
      let score = workgroupSalience[candidate];
      if (score <= 0.0 || score <= bestScore) {
        continue;
      }

      let previous = select(
        -1.0, workgroupSalience[candidate - 1u], candidate > 0u);
      let next = select(
        -1.0, workgroupSalience[candidate + 1u],
        candidate + 1u < candidateCount);
      if (score < previous || score <= next) {
        continue;
      }

      var tooClose = false;
      for (var prior = 0u; prior < poolFilled; prior += 1u) {
        let distance =
          u32(abs(i32(candidate) - i32(pickedCandidate[prior])));
        if (distance < separationCandidates) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) {
        continue;
      }

      bestScore = score;
      bestCandidate = candidate;
    }

    if (bestCandidate == candidateCount) {
      break;
    }

    var frequency = frequencyAtCandidate(bestCandidate);
    if (bestCandidate > 0u && bestCandidate + 1u < candidateCount) {
      let previous = workgroupSalience[bestCandidate - 1u];
      let next = workgroupSalience[bestCandidate + 1u];
      let denominator = previous - 2.0 * bestScore + next;
      if (abs(denominator) > 0.000001) {
        let offset = clamp(0.5 * (previous - next) / denominator, -1.0, 1.0);
        frequency *= exp2(offset * params.candidateStepCents / 1200.0);
      }
    }

    pickedCandidate[poolFilled] = bestCandidate;
    lattice[latticeBase + poolFilled] = vec2<f32>(frequency, bestScore);
    poolFilled += 1u;
  }

  for (var slot = poolFilled; slot < latticeCount; slot += 1u) {
    lattice[latticeBase + slot] = vec2<f32>(0.0, 0.0);
  }
}
`;
