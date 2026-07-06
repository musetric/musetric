import { fundamentalFrequencyParamsStruct } from './paramsStruct.wgsl.js';

export const shader = `
${fundamentalFrequencyParamsStruct}

struct CandidateStats {
  score: f32,
  harmonicMean: f32,
  noiseScore: f32,
  fundamentalProminence: f32,
  supportCount: u32,
  oddMean: f32,
  evenMean: f32,
  swipe: f32,
};

@group(0) @binding(0) var<storage, read> signal: array<f32>;
@group(0) @binding(2) var<storage, read_write> lattice: array<vec2<f32>>;
@group(0) @binding(3) var<uniform> params: FundamentalFrequencyParams;

const workgroupWidth = 64u;
const localPeakCount = 2u;
const maxLatticeCount = 8u;

const harmonicWeights = array<f32, 11>(
  0.0,
  1.0,
  0.707106781,
  0.577350269,
  0.5,
  0.447213595,
  0.40824829,
  0.377964473,
  0.353553391,
  0.333333333,
  0.316227766,
);

const prominenceProbeRatio = 1.041243772;

const swipeTapCount = 4u;
const swipeTapOffsets = array<f32, 4>(
  -0.416666667,
  -0.083333333,
  0.083333333,
  0.416666667,
);
const swipeTapCosines = array<f32, 4>(
  -0.866025404,
  0.866025404,
  0.866025404,
  -0.866025404,
);

var<workgroup> workgroupScores: array<f32, 128>;
var<workgroup> workgroupCandidates: array<u32, 128>;

const twmPoolCount = 5u;

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

fn loudnessAt(windowIndex: u32, frequency: f32) -> f32 {
  return sqrt(sqrt(max(sampleIntensity(windowIndex, frequency), 0.0)));
}

fn swipeSalience(windowIndex: u32, frequency: f32) -> f32 {
  var numerator = 0.0;
  var kernelEnergy = 0.0;
  var loudnessEnergy = 0.0;
  let nyquistFrequency = params.sampleRate * 0.5;

  for (var harmonic = 1u; harmonic <= params.harmonicCount; harmonic += 1u) {
    let weight = harmonicWeights[harmonic];
    for (var tap = 0u; tap < swipeTapCount; tap += 1u) {
      var kernel = swipeTapCosines[tap] * weight;
      if (kernel < 0.0) {
        kernel *= params.swipeNegativeScale;
      }

      let sampleFrequency = frequency * (f32(harmonic) + swipeTapOffsets[tap]);
      if (sampleFrequency <= 0.0 || sampleFrequency >= nyquistFrequency) {
        continue;
      }

      let loudness = loudnessAt(windowIndex, sampleFrequency);
      numerator += kernel * loudness;
      kernelEnergy += kernel * kernel;
      loudnessEnergy += loudness * loudness;
    }
  }

  let denominator =
    sqrt(kernelEnergy * loudnessEnergy) + params.swipeNormalizeBias;
  if (denominator <= 0.0) {
    return 0.0;
  }

  return numerator / denominator;
}

fn spectralProminence(windowIndex: u32, frequency: f32) -> f32 {
  let center = sampleIntensity(windowIndex, frequency);
  let lower = sampleIntensity(windowIndex, frequency / prominenceProbeRatio);
  let upper = sampleIntensity(windowIndex, frequency * prominenceProbeRatio);
  let localFloor = max(lower, upper) * 0.5;
  return max(center - localFloor, 0.0);
}

fn centsBetween(left: f32, right: f32) -> f32 {
  if (left <= 0.0 || right <= 0.0) {
    return 0.0;
  }
  return abs(1200.0 * log2(left / right));
}

fn nearestHarmonicCents(windowIndex: u32, frequency: f32, candidate: f32) -> f32 {
  var best = 1000000.0;
  for (var harmonic = 1u; harmonic <= params.harmonicCount; harmonic += 1u) {
    let harmonicFrequency = candidate * f32(harmonic);
    if (harmonicFrequency >= params.sampleRate * 0.5) {
      break;
    }
    let centsOff = centsBetween(frequency, harmonicFrequency);
    if (centsOff < best) {
      best = centsOff;
    }
  }
  return best;
}

fn reverseMismatchPenalty(
  windowIndex: u32,
  frequency: f32,
) -> f32 {
  let nyquistFrequency = params.sampleRate * 0.5;
  let lower = max(params.minimumFrequency, frequency * 0.5);
  let upper = min(nyquistFrequency, frequency * 2.0);
  if (upper <= lower) {
    return 1.0;
  }

  let maxSteps = 128u;
  let centsRange = 1200.0 * log2(upper / lower);
  let rawSteps = u32(centsRange / params.candidateStepCents) + 1u;
  let steps = min(rawSteps, maxSteps);

  let sigma = max(params.twmReverseSigmaCents, 1.0);
  var onGridEnergy = 0.0;
  var offGridEnergy = 0.0;
  for (var step = 0u; step < steps; step += 1u) {
    let position = lower * exp2(f32(step) * params.candidateStepCents / 1200.0);
    if (position >= upper) {
      break;
    }
    let prom = spectralProminence(windowIndex, position);
    if (prom < params.minimumFundamentalIntensity) {
      continue;
    }
    let centsOff = nearestHarmonicCents(windowIndex, position, frequency);
    let sigmaRatio = centsOff / sigma;
    let sigmaTerm = 1.0 - exp(-0.5 * sigmaRatio * sigmaRatio);
    onGridEnergy += prom * (1.0 - sigmaTerm);
    offGridEnergy += prom * sigmaTerm;
  }
  let totalEnergy = onGridEnergy + offGridEnergy;
  if (totalEnergy <= 0.0) {
    return 1.0;
  }
  return clamp(onGridEnergy / totalEnergy, 0.0, 1.0);
}

fn baseCandidateStats(windowIndex: u32, frequency: f32) -> CandidateStats {
  var weighted = 0.0;
  var totalWeight = 0.0;
  var supportCount = 0u;
  var oddWeighted = 0.0;
  var oddWeight = 0.0;
  var evenWeighted = 0.0;
  var evenWeight = 0.0;
  var fundamentalProminence = 0.0;

  for (var harmonic = 1u; harmonic <= params.harmonicCount; harmonic += 1u) {
    let harmonicFrequency = frequency * f32(harmonic);
    if (harmonicFrequency >= params.sampleRate * 0.5) {
      break;
    }

    let weight = harmonicWeights[harmonic];
    let peak = spectralProminence(windowIndex, harmonicFrequency);
    if (harmonic == 1u) {
      fundamentalProminence = peak;
    }

    weighted += peak * weight;
    totalWeight += weight;
    if (peak >= params.minimumFundamentalIntensity) {
      supportCount += 1u;
    }

    if (harmonic % 2u == 1u) {
      oddWeighted += peak * weight;
      oddWeight += weight;
    } else {
      evenWeighted += peak * weight;
      evenWeight += weight;
    }
  }

  var harmonicMean = 0.0;
  if (totalWeight > 0.0) {
    harmonicMean = weighted / totalWeight;
  }

  var oddMean = 0.0;
  if (oddWeight > 0.0) {
    oddMean = oddWeighted / oddWeight;
  }

  var evenMean = 0.0;
  if (evenWeight > 0.0) {
    evenMean = evenWeighted / evenWeight;
  }

  var noiseWeighted = 0.0;
  var noiseWeight = 0.0;
  let noiseCount = min(params.harmonicCount, 8u);
  for (var harmonic = 1u; harmonic < noiseCount; harmonic += 1u) {
    let harmonicFrequency = frequency * (f32(harmonic) + 0.5);
    if (harmonicFrequency >= params.sampleRate * 0.5) {
      break;
    }

    let weight = harmonicWeights[harmonic];
    noiseWeighted += sampleIntensity(windowIndex, harmonicFrequency) * weight;
    noiseWeight += weight;
  }

  var noiseScore = 0.0;
  if (noiseWeight > 0.0) {
    noiseScore = noiseWeighted / noiseWeight;
  }

  let swipe = swipeSalience(windowIndex, frequency);

  let score = harmonicMean * 0.62 +
    oddMean * 0.28 +
    fundamentalProminence * 0.22 +
    min(evenMean, oddMean + 0.08) * 0.08 -
    noiseScore * 0.34 +
    swipe * params.swipeMixWeight;

  return CandidateStats(
    score,
    harmonicMean,
    noiseScore,
    fundamentalProminence,
    supportCount,
    oddMean,
    evenMean,
    swipe,
  );
}

fn minimumSupportCount(frequency: f32) -> u32 {
  if (frequency < 130.0) {
    return 4u;
  }

  if (frequency < 520.0) {
    return 3u;
  }

  return 2u;
}

fn candidatePasses(frequency: f32, stats: CandidateStats) -> bool {
  if (stats.supportCount < minimumSupportCount(frequency)) {
    return false;
  }

  if (stats.score < params.minimumScore) {
    return false;
  }

  if (stats.swipe < params.swipeGate) {
    return false;
  }

  if (stats.harmonicMean < stats.noiseScore * 1.08 + 0.035) {
    return false;
  }

  if (
    stats.fundamentalProminence < params.minimumFundamentalIntensity * 0.65 &&
    stats.supportCount < minimumSupportCount(frequency) + 1u
  ) {
    return false;
  }

  return true;
}

fn isWeakSubtone(
  windowIndex: u32,
  frequency: f32,
  stats: CandidateStats,
) -> bool {
  if (frequency >= 190.0) {
    return false;
  }

  let doubleFrequency = frequency * 2.0;
  if (doubleFrequency >= params.sampleRate * 0.5) {
    return false;
  }

  let doubleIntensity = sampleIntensity(windowIndex, doubleFrequency);
  return (
    stats.fundamentalProminence < params.minimumFundamentalIntensity * 1.45 &&
    stats.oddMean < stats.evenMean * 0.72 &&
    doubleIntensity >= stats.fundamentalProminence * 1.45 + 0.12
  );
}

fn isLikelyOvertone(
  windowIndex: u32,
  frequency: f32,
  stats: CandidateStats,
) -> bool {
  if (frequency < 140.0) {
    return false;
  }

  for (var divisor = 2u; divisor <= 3u; divisor += 1u) {
    let lowerFrequency = frequency / f32(divisor);
    if (lowerFrequency < params.minimumFrequency) {
      break;
    }

    let lowerStats = baseCandidateStats(windowIndex, lowerFrequency);
    if (
      candidatePasses(lowerFrequency, lowerStats) &&
      lowerStats.score >= stats.score * 0.82 &&
      lowerStats.fundamentalProminence >=
        params.minimumFundamentalIntensity * 0.7
    ) {
      return true;
    }
  }

  return false;
}

fn harmonicScore(windowIndex: u32, frequency: f32) -> f32 {
  let stats = baseCandidateStats(windowIndex, frequency);
  if (!candidatePasses(frequency, stats)) {
    return 0.0;
  }

  if (isWeakSubtone(windowIndex, frequency, stats)) {
    return 0.0;
  }

  if (isLikelyOvertone(windowIndex, frequency, stats)) {
    return 0.0;
  }

  return stats.score;
}

fn refinementScore(windowIndex: u32, frequency: f32) -> f32 {
  let stats = baseCandidateStats(windowIndex, frequency);
  return max(stats.score, 0.0);
}

fn refinePeak(windowIndex: u32, candidate: u32) -> f32 {
  let coarse = frequencyAtCandidate(candidate);
  if (candidate == 0u || candidate + 1u >= params.candidateCount) {
    return coarse;
  }

  let fineStepRatio = exp2(params.candidateStepCents / 1200.0);
  let centerScore = refinementScore(windowIndex, coarse);
  let previousScore = refinementScore(windowIndex, coarse / fineStepRatio);
  let nextScore = refinementScore(windowIndex, coarse * fineStepRatio);
  let denominator = previousScore - 2.0 * centerScore + nextScore;
  if (abs(denominator) <= 0.000001) {
    return coarse;
  }

  let offset = clamp(0.5 * (previousScore - nextScore) / denominator, -1.0, 1.0);
  return coarse * exp2(offset * params.candidateStepCents / 1200.0);
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
  let candidateCount = params.candidateCount;
  let latticeCount = min(params.latticeCount, maxLatticeCount);

  var localScore = array<f32, 2>(0.0, 0.0);
  var localCandidate = array<u32, 2>(candidateCount, candidateCount);
  for (
    var candidate = threadIndex;
    candidate < candidateCount;
    candidate += workgroupWidth
  ) {
    let score = harmonicScore(windowIndex, frequencyAtCandidate(candidate));
    if (score <= 0.0) {
      continue;
    }

    if (score > localScore[0]) {
      localScore[1] = localScore[0];
      localCandidate[1] = localCandidate[0];
      localScore[0] = score;
      localCandidate[0] = candidate;
    } else if (score > localScore[1]) {
      localScore[1] = score;
      localCandidate[1] = candidate;
    }
  }

  for (var slot = 0u; slot < localPeakCount; slot += 1u) {
    let sharedIndex = threadIndex * localPeakCount + slot;
    workgroupScores[sharedIndex] = localScore[slot];
    workgroupCandidates[sharedIndex] = localCandidate[slot];
  }
  workgroupBarrier();

  if (threadIndex != 0u) {
    return;
  }

  let entryCount = workgroupWidth * localPeakCount;
  let separationCandidates =
    u32(max(1.0, params.peakSeparationCents / params.candidateStepCents));
  var pickedCandidate = array<u32, 8>(0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u);
  var poolCheapScore =
    array<f32, 8>(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
  let latticeBase = windowIndex * params.latticeCount;

  var poolFilled = 0u;
  for (var picked = 0u; picked < twmPoolCount; picked += 1u) {
    var bestScore = 0.0;
    var bestEntry = entryCount;
    for (var entry = 0u; entry < entryCount; entry += 1u) {
      let score = workgroupScores[entry];
      if (score <= 0.0) {
        continue;
      }

      let candidate = workgroupCandidates[entry];
      var tooClose = false;
      for (var prior = 0u; prior < poolFilled; prior += 1u) {
        let distance = u32(abs(i32(candidate) - i32(pickedCandidate[prior])));
        if (distance < separationCandidates) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) {
        continue;
      }

      if (score > bestScore) {
        bestScore = score;
        bestEntry = entry;
      }
    }

    if (bestEntry == entryCount) {
      break;
    }

    let candidate = workgroupCandidates[bestEntry];
    pickedCandidate[poolFilled] = candidate;
    poolCheapScore[poolFilled] = bestScore;
    workgroupScores[bestEntry] = 0.0;
    poolFilled += 1u;
  }

  var poolAdjusted =
    array<f32, 8>(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
  for (var i = 0u; i < poolFilled; i += 1u) {
    let cand = pickedCandidate[i];
    let f = frequencyAtCandidate(cand);
    let stats = baseCandidateStats(windowIndex, f);
    let forwardFit = clamp(stats.harmonicMean - stats.noiseScore, -1.0, 1.0);
    let harmonicFit = reverseMismatchPenalty(windowIndex, f);
    let reverseTerm = (2.0 * harmonicFit - 1.0) * params.twmReverseWeight;
    let twmBonus = clamp(forwardFit + reverseTerm, -1.0, 1.0);
    poolAdjusted[i] = poolCheapScore[i] + params.twmMixWeight * twmBonus;
  }

  var usedMask = array<u32, 8>(0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u);
  for (var picked = 0u; picked < latticeCount; picked += 1u) {
    var bestIdx = 0xffffffffu;
    var bestCand = 0xffffffffu;
    var bestScore = -1.0;
    for (var i = 0u; i < poolFilled; i += 1u) {
      if (usedMask[i] != 0u) {
        continue;
      }
      let cand = pickedCandidate[i];
      let score = poolAdjusted[i];
      if (
        score > bestScore ||
        (score == bestScore && cand < bestCand)
      ) {
        bestIdx = i;
        bestCand = cand;
        bestScore = score;
      }
    }

    if (bestIdx == 0xffffffffu) {
      lattice[latticeBase + picked] = vec2<f32>(0.0, 0.0);
      continue;
    }

    usedMask[bestIdx] = 1u;
    lattice[latticeBase + picked] =
      vec2<f32>(refinePeak(windowIndex, bestCand), bestScore);
  }
}
`;
