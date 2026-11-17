import { pitchParamsStruct } from './paramsStruct.wgsl.js';
import { pitchSalienceFunctions } from './salience.wgsl.js';
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
@group(0) @binding(6) var<uniform> params: PitchParams;

const workgroupWidth = 64u;
const latticeSize = 5u;
const maxCandidateCount = 512u;
const maxRefineHarmonics = 40u;

var<workgroup> salience: array<f32, 512>;
var<workgroup> picked: array<vec2<f32>, 5>;
var<workgroup> chosen: array<u32, 5>;
var<workgroup> coarse: array<f32, 5>;
var<workgroup> pickedCount: u32;
var<workgroup> pickDone: u32;
var<workgroup> bestKey: atomic<u32>;
var<workgroup> bestIndex: atomic<u32>;
var<workgroup> peakPeriodicity: array<f32, 64>;

fn frequencyAtCandidate(candidate: u32) -> f32 {
  return params.minimumFrequency *
    exp2(f32(candidate) * params.candidateStepCents / 1200.0);
}

fn binFrequency() -> f32 {
  return params.sampleRate / f32(params.fftSize);
}

${pitchSalienceFunctions}
fn refineTerm(
  slotIndex: u32,
  frequency: f32,
  harmonic: u32,
  tolerance: f32,
) -> vec2<f32> {
  let binWidth = binFrequency();
  let maxFrequency = f32(params.phaseBins - 1u) * binWidth;
  let expected = frequency * f32(harmonic);
  if (expected >= maxFrequency) {
    return vec2<f32>(0.0, 0.0);
  }
  let spectrumBase = slotIndex * params.spectrumBins;
  let frequencyBase = slotIndex * params.phaseBins;
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
  let measured = frequencies[frequencyBase + bestBin];
  if (measured <= 0.0 || abs(measured - expected) > tolerance * expected) {
    return vec2<f32>(0.0, 0.0);
  }
  let weight = max(bestValue, 0.0);
  return vec2<f32>(weight * measured / f32(harmonic), weight);
}

fn fillRefineTerms(
  slotIndex: u32,
  threadIndex: u32,
  count: u32,
  harmonics: u32,
  tolerance: f32,
  fine: bool,
) {
  for (var item = threadIndex; item < count * harmonics; item += workgroupWidth) {
    let pick = item / harmonics;
    let harmonic = item % harmonics + 1u;
    let frequency = select(picked[pick].x, coarse[pick], fine);
    let term = refineTerm(slotIndex, frequency, harmonic, tolerance);
    let slot = 2u * (pick * maxRefineHarmonics + harmonic - 1u);
    salience[slot] = term.x;
    salience[slot + 1u] = term.y;
  }
}

fn refinedFrequency(pick: u32, harmonics: u32, frequency: f32) -> f32 {
  var weighted = 0.0;
  var total = 0.0;
  for (var harmonic = 0u; harmonic < harmonics; harmonic += 1u) {
    let slot = 2u * (pick * maxRefineHarmonics + harmonic);
    weighted += salience[slot];
    total += salience[slot + 1u];
  }
  if (total <= 0.0) {
    return frequency;
  }
  return weighted / total;
}

fn harmonicSharePart(slotIndex: u32, frequency: f32, threadIndex: u32) -> vec2<f32> {
  let binWidth = binFrequency();
  let bins = min(params.phaseBins, params.spectrumBins);
  let base = slotIndex * params.spectrumBins;
  var harmonic = 0.0;
  var total = 0.0;
  for (var bin = 1u + threadIndex; bin < bins; bin += workgroupWidth) {
    let value = whitened[base + bin];
    let energy = value * value;
    total += energy;
    let order = round(f32(bin) * binWidth / frequency);
    if (order >= 1.0 && abs(f32(bin) - order * frequency / binWidth) <= 1.5) {
      harmonic += energy;
    }
  }
  return vec2<f32>(harmonic, total);
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

  if (threadIndex == 0u) {
    pickedCount = 0u;
    pickDone = 0u;
    atomicStore(&bestKey, 0u);
    atomicStore(&bestIndex, candidateCount);
  }
  for (var candidate = threadIndex; candidate < candidateCount; candidate += workgroupWidth) {
    salience[candidate] = candidateSalience(slotIndex, frequencyAtCandidate(candidate), gate);
  }
  var peak = 0.0;
  for (var lag = threadIndex; lag < params.lagCount; lag += workgroupWidth) {
    peak = max(peak, periodicity[slotIndex * params.lagCount + lag]);
  }
  peakPeriodicity[threadIndex] = peak;
  workgroupBarrier();

  let separation = u32(max(1.0, params.peakSeparationCents / params.candidateStepCents));
  for (var rank = 0u; rank < latticeSize; rank += 1u) {
    var bestScore = 0.0;
    var bestCandidate = candidateCount;
    for (var candidate = threadIndex; candidate < candidateCount; candidate += workgroupWidth) {
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
      for (var prior = 0u; prior < rank; prior += 1u) {
        if (u32(abs(i32(candidate) - i32(chosen[prior]))) < separation) {
          tooClose = true;
        }
      }
      if (!tooClose) {
        bestScore = score;
        bestCandidate = candidate;
      }
    }
    if (bestCandidate < candidateCount) {
      atomicMax(&bestKey, bitcast<u32>(bestScore));
    }
    workgroupBarrier();
    if (bestCandidate < candidateCount && bitcast<u32>(bestScore) == atomicLoad(&bestKey)) {
      atomicMin(&bestIndex, bestCandidate);
    }
    workgroupBarrier();
    if (threadIndex == 0u) {
      let winner = atomicLoad(&bestIndex);
      if (winner == candidateCount) {
        pickDone = 1u;
      } else {
        let score = bitcast<f32>(atomicLoad(&bestKey));
        var frequency = frequencyAtCandidate(winner);
        if (winner > 0u && winner + 1u < candidateCount) {
          let previous = salience[winner - 1u];
          let next = salience[winner + 1u];
          let denominator = previous - 2.0 * score + next;
          if (abs(denominator) > 0.000001) {
            let offset = clamp(0.5 * (previous - next) / denominator, -1.0, 1.0);
            frequency *= exp2(offset * params.candidateStepCents / 1200.0);
          }
        }
        chosen[rank] = winner;
        picked[rank] = vec2<f32>(frequency, score);
        pickedCount = rank + 1u;
      }
      atomicStore(&bestKey, 0u);
      atomicStore(&bestIndex, candidateCount);
    }
    if (workgroupUniformLoad(&pickDone) == 1u) {
      break;
    }
  }

  let count = workgroupUniformLoad(&pickedCount);
  let coarseHarmonics = min(params.coarseRefineHarmonics, maxRefineHarmonics);
  let fineHarmonics = min(params.refineHarmonics, maxRefineHarmonics);
  fillRefineTerms(slotIndex, threadIndex, count, coarseHarmonics, params.coarseRefineTolerance, false);
  workgroupBarrier();
  if (threadIndex < count) {
    coarse[threadIndex] = refinedFrequency(threadIndex, coarseHarmonics, picked[threadIndex].x);
  }
  workgroupBarrier();
  fillRefineTerms(slotIndex, threadIndex, count, fineHarmonics, params.refineTolerance, true);
  workgroupBarrier();
  if (threadIndex < count) {
    picked[threadIndex] = vec2<f32>(
      refinedFrequency(threadIndex, fineHarmonics, coarse[threadIndex]),
      picked[threadIndex].y,
    );
  }
  workgroupBarrier();
  if (count > 0u) {
    let part = harmonicSharePart(slotIndex, picked[0].x, threadIndex);
    salience[2u * threadIndex] = part.x;
    salience[2u * threadIndex + 1u] = part.y;
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
    if (index < count) {
      observation.candidates[index] = picked[index];
    }
  }
  var best = 0.0;
  var share = 0.0;
  if (count > 0u) {
    best = picked[0].y;
    var harmonicEnergy = 0.0;
    var totalEnergy = 0.0;
    for (var index = 0u; index < workgroupWidth; index += 1u) {
      harmonicEnergy += salience[2u * index];
      totalEnergy += salience[2u * index + 1u];
    }
    share = select(0.0, harmonicEnergy / totalEnergy, totalEnergy > 0.0);
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
