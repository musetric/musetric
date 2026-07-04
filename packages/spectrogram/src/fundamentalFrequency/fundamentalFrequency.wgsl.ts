export const shader = `
struct FundamentalFrequencyParams {
  halfSize: u32,
  windowCount: u32,
  windowSize: u32,
  candidateCount: u32,
  sampleRate: f32,
  minimumFrequency: f32,
  candidateStepCents: f32,
  minimumFundamentalIntensity: f32,
  minimumScore: f32,
  harmonicCount: u32,
  slotOffset: u32,
  columnCount: u32,
  screenBase: u32,
  baseSlot: u32,
  latticeCount: u32,
  trackWindow: u32,
  jumpCostCents: f32,
  unvoicedCost: f32,
  voicedTransitionCost: f32,
};

struct CandidateStats {
  score: f32,
  harmonicMean: f32,
  noiseScore: f32,
  fundamentalProminence: f32,
  supportCount: u32,
  oddMean: f32,
  evenMean: f32,
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

var<workgroup> workgroupScores: array<f32, 128>;
var<workgroup> workgroupCandidates: array<u32, 128>;

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

  let score = harmonicMean * 0.62 +
    oddMean * 0.28 +
    fundamentalProminence * 0.22 +
    min(evenMean, oddMean + 0.08) * 0.08 -
    noiseScore * 0.34;

  return CandidateStats(
    score,
    harmonicMean,
    noiseScore,
    fundamentalProminence,
    supportCount,
    oddMean,
    evenMean,
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
  let separationCandidates = u32(max(1.0, 60.0 / params.candidateStepCents));
  var pickedCandidate = array<u32, 8>();
  let latticeBase = windowIndex * params.latticeCount;

  for (var picked = 0u; picked < latticeCount; picked += 1u) {
    var bestScore = 0.0;
    var bestEntry = entryCount;
    for (var entry = 0u; entry < entryCount; entry += 1u) {
      let score = workgroupScores[entry];
      if (score <= 0.0) {
        continue;
      }

      let candidate = workgroupCandidates[entry];
      var tooClose = false;
      for (var prior = 0u; prior < picked; prior += 1u) {
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
      lattice[latticeBase + picked] = vec2<f32>(0.0, 0.0);
      continue;
    }

    let candidate = workgroupCandidates[bestEntry];
    pickedCandidate[picked] = candidate;
    workgroupScores[bestEntry] = 0.0;
    lattice[latticeBase + picked] =
      vec2<f32>(refinePeak(windowIndex, candidate), bestScore);
  }
}
`;
