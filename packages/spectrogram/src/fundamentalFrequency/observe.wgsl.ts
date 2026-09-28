import { pitchParamsStruct } from './paramsStruct.wgsl.js';
import { pitchObservationStruct, pitchSlotStruct } from './slots.wgsl.js';

export const observeShader = `
${pitchParamsStruct}
${pitchSlotStruct}
${pitchObservationStruct}

@group(0) @binding(0) var<storage, read> slots: array<PitchSlot>;
@group(0) @binding(1) var<storage, read> whitened: array<f32>;
@group(0) @binding(2) var<storage, read> frequencies: array<f32>;
@group(0) @binding(3) var<storage, read> levels: array<f32>;
@group(0) @binding(4) var<storage, read> periodicity: array<f32>;
@group(0) @binding(5) var<storage, read_write> observations: array<PitchObservation>;
@group(0) @binding(6) var<storage, read> signal: array<f32>;
@group(0) @binding(7) var<uniform> params: PitchParams;

const workgroupWidth = 64u;
const latticeSize = 5u;
const maxCandidateCount = 512u;
const prominenceProbeRatio = 1.041243772;

const harmonicWeights = array<f32, 11>(
  0.0, 1.0, 0.5, 0.333333333, 0.25, 0.2,
  0.166666667, 0.142857143, 0.125, 0.111111111, 0.1,
);

var<workgroup> salience: array<f32, 512>;
var<workgroup> picked: array<vec2<f32>, 5>;
var<workgroup> pickedCount: u32;
var<workgroup> peakPeriodicity: array<f32, 64>;

fn frequencyAtCandidate(candidate: u32) -> f32 {
  return params.minimumFrequency *
    exp2(f32(candidate) * params.candidateStepCents / 1200.0);
}

fn binFrequency() -> f32 {
  return params.sampleRate / f32(params.fftSize);
}

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

fn powerAt(slotIndex: u32, bin: u32) -> f32 {
  let offset = slotIndex * (params.fftSize + 2u) + 2u * bin;
  let value = vec2<f32>(signal[offset], signal[offset + 1u]);
  return dot(value, value);
}

fn refineWith(
  slotIndex: u32,
  frequency: f32,
  harmonics: u32,
  tolerance: f32,
) -> f32 {
  let binWidth = binFrequency();
  let maxFrequency = f32(params.phaseBins - 1u) * binWidth;
  let spectrumBase = slotIndex * params.spectrumBins;
  let frequencyBase = slotIndex * params.phaseBins;
  let minimumPower = exp2(
    (levels[slotIndex] + params.levelOffsetDb - params.refineRangeDb) /
      3.01029996,
  );
  var weighted = 0.0;
  var total = 0.0;
  for (var harmonic = 1u; harmonic <= harmonics; harmonic += 1u) {
    let expected = frequency * f32(harmonic);
    if (expected >= maxFrequency) {
      break;
    }
    let center = expected / binWidth;
    let reach = max(params.refineSearchBins, tolerance * center);
    let low = u32(max(1.0, floor(center - reach)));
    let high = min(params.phaseBins - 1u, u32(ceil(center + reach)));
    var bestBin = low;
    var bestValue = -1.0;
    for (var bin = low; bin <= high; bin += 1u) {
      let value = whitened[spectrumBase + bin];
      if (value > bestValue) {
        bestValue = value;
        bestBin = bin;
      }
    }
    if (powerAt(slotIndex, bestBin) < minimumPower) {
      continue;
    }
    let measured = frequencies[frequencyBase + bestBin];
    if (measured <= 0.0 || abs(measured - expected) > tolerance * expected) {
      continue;
    }
    let weight = max(bestValue, 0.0);
    weighted += weight * measured / f32(harmonic);
    total += weight;
  }
  if (total <= 0.0) {
    return frequency;
  }
  return weighted / total;
}

fn refine(slotIndex: u32, frequency: f32) -> f32 {
  let coarse = refineWith(
    slotIndex,
    frequency,
    params.coarseRefineHarmonics,
    params.coarseRefineTolerance,
  );
  return refineWith(
    slotIndex,
    coarse,
    params.refineHarmonics,
    params.refineTolerance,
  );
}

fn harmonicShare(slotIndex: u32, frequency: f32) -> f32 {
  let binWidth = binFrequency();
  let bins = min(params.phaseBins, params.spectrumBins);
  let base = slotIndex * params.spectrumBins;
  var harmonic = 0.0;
  var total = 0.0;
  for (var bin = 1u; bin < bins; bin += 1u) {
    let value = whitened[base + bin];
    let energy = value * value;
    total += energy;
    let order = round(f32(bin) * binWidth / frequency);
    if (order >= 1.0 && abs(f32(bin) - order * frequency / binWidth) <= 1.5) {
      harmonic += energy;
    }
  }
  if (total <= 0.0) {
    return 0.0;
  }
  return harmonic / total;
}

@compute @workgroup_size(64)
fn observe(
  @builtin(workgroup_id) workgroupId: vec3<u32>,
  @builtin(local_invocation_id) localId: vec3<u32>,
) {
  let slotIndex = workgroupId.x;
  let threadIndex = localId.x;
  if (slotIndex >= params.slotCount) {
    return;
  }
  let candidateCount = min(params.candidateCount, maxCandidateCount);
  let level = levels[slotIndex];
  let gate = clamp((level - params.levelFloorDb) / max(params.levelRangeDb, 0.001), 0.0, 1.0);

  for (var candidate = threadIndex; candidate < candidateCount; candidate += workgroupWidth) {
    salience[candidate] = candidateSalience(slotIndex, frequencyAtCandidate(candidate), gate);
  }
  var peak = 0.0;
  for (var lag = threadIndex; lag < params.lagCount; lag += workgroupWidth) {
    peak = max(peak, periodicity[slotIndex * params.lagCount + lag]);
  }
  peakPeriodicity[threadIndex] = peak;
  workgroupBarrier();

  if (threadIndex == 0u) {
    let separation = u32(max(1.0, params.peakSeparationCents / params.candidateStepCents));
    var chosen = array<u32, 5>(0u, 0u, 0u, 0u, 0u);
    var count = 0u;
    for (var rank = 0u; rank < latticeSize; rank += 1u) {
      var bestScore = 0.0;
      var bestCandidate = candidateCount;
      for (var candidate = 0u; candidate < candidateCount; candidate += 1u) {
        let score = salience[candidate];
        if (score <= bestScore) {
          continue;
        }
        let previous = select(-1.0, salience[candidate - 1u], candidate > 0u);
        let next = select(-1.0, salience[candidate + 1u], candidate + 1u < candidateCount);
        if (score < previous || score <= next) {
          continue;
        }
        var tooClose = false;
        for (var prior = 0u; prior < count; prior += 1u) {
          if (u32(abs(i32(candidate) - i32(chosen[prior]))) < separation) {
            tooClose = true;
          }
        }
        if (!tooClose) {
          bestScore = score;
          bestCandidate = candidate;
        }
      }
      if (bestCandidate == candidateCount) {
        break;
      }
      var frequency = frequencyAtCandidate(bestCandidate);
      if (bestCandidate > 0u && bestCandidate + 1u < candidateCount) {
        let previous = salience[bestCandidate - 1u];
        let next = salience[bestCandidate + 1u];
        let denominator = previous - 2.0 * bestScore + next;
        if (abs(denominator) > 0.000001) {
          let offset = clamp(0.5 * (previous - next) / denominator, -1.0, 1.0);
          frequency *= exp2(offset * params.candidateStepCents / 1200.0);
        }
      }
      chosen[count] = bestCandidate;
      picked[count] = vec2<f32>(frequency, bestScore);
      count += 1u;
    }
    pickedCount = count;
  }
  workgroupBarrier();

  if (threadIndex < latticeSize && threadIndex < pickedCount) {
    let entry = picked[threadIndex];
    picked[threadIndex] = vec2<f32>(refine(slotIndex, entry.x), entry.y);
  }
  workgroupBarrier();

  let slot = slots[slotIndex];
  if (threadIndex != 0u || slot.observe == 0u) {
    return;
  }
  var periodicityPeak = 0.0;
  for (var index = 0u; index < workgroupWidth; index += 1u) {
    periodicityPeak = max(periodicityPeak, peakPeriodicity[index]);
  }
  var observation: PitchObservation;
  for (var index = 0u; index < latticeSize; index += 1u) {
    observation.candidates[index] = vec2<f32>(0.0, 0.0);
    if (index < pickedCount) {
      observation.candidates[index] = picked[index];
    }
  }
  var best = 0.0;
  var share = 0.0;
  if (pickedCount > 0u) {
    best = picked[0].y;
    share = harmonicShare(slotIndex, picked[0].x);
  }
  let z = params.voicingBias +
    params.voicingPeriodicity * periodicityPeak +
    params.voicingSalience * log(best + 0.01) +
    params.voicingShare * share +
    params.voicingLevel * level;
  observation.voicing = 1.0 / (1.0 + exp(-z));
  observation.frame = slot.frame;
  observation.level = level;
  observations[u32(slot.frame) % params.ringFrames] = observation;
}
`;
