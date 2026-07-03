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
@group(0) @binding(2) var<storage, read_write> rawOutput: array<f32>;
@group(0) @binding(3) var<uniform> params: FundamentalFrequencyParams;

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

var<workgroup> workgroupScores: array<f32, 256>;
var<workgroup> workgroupCandidates: array<u32, 256>;

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

fn shouldReplaceBest(
  score: f32,
  candidate: u32,
  bestScore: f32,
  bestCandidate: u32,
) -> bool {
  return score > bestScore || (score == bestScore && candidate < bestCandidate);
}

@compute @workgroup_size(256)
fn scoreAndPick(
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

  var bestScore = 0.0;
  var bestCandidate = 0u;
  for (
    var candidate = threadIndex;
    candidate < candidateCount;
    candidate += 256u
  ) {
    let candidateScore = harmonicScore(
      windowIndex,
      frequencyAtCandidate(candidate),
    );
    if (
      shouldReplaceBest(
        candidateScore,
        candidate,
        bestScore,
        bestCandidate,
      )
    ) {
      bestScore = candidateScore;
      bestCandidate = candidate;
    }
  }

  workgroupScores[threadIndex] = bestScore;
  workgroupCandidates[threadIndex] = bestCandidate;
  workgroupBarrier();

  for (var stride = 128u; stride > 0u; stride = stride / 2u) {
    if (threadIndex < stride) {
      let otherScore = workgroupScores[threadIndex + stride];
      let otherCandidate = workgroupCandidates[threadIndex + stride];
      if (
        shouldReplaceBest(
          otherScore,
          otherCandidate,
          workgroupScores[threadIndex],
          workgroupCandidates[threadIndex],
        )
      ) {
        workgroupScores[threadIndex] = otherScore;
        workgroupCandidates[threadIndex] = otherCandidate;
      }
    }
    workgroupBarrier();
  }

  if (threadIndex != 0u) {
    return;
  }

  bestScore = workgroupScores[0];
  bestCandidate = workgroupCandidates[0];
  if (bestScore <= 0.0) {
    rawOutput[windowIndex] = 0.0;
    return;
  }

  let fineStepRatio = exp2(params.candidateStepCents * 0.5 / 1200.0);
  let coarseBestFrequency = frequencyAtCandidate(bestCandidate);
  var bestFrequency = coarseBestFrequency;

  if (bestCandidate > 0u) {
    let previousFrequency = coarseBestFrequency / fineStepRatio;
    let previousScore = harmonicScore(windowIndex, previousFrequency);
    if (previousScore > bestScore) {
      bestScore = previousScore;
      bestFrequency = previousFrequency;
    }
  }

  if (bestCandidate + 1u < candidateCount) {
    let nextFrequency = coarseBestFrequency * fineStepRatio;
    let nextScore = harmonicScore(windowIndex, nextFrequency);
    if (nextScore > bestScore) {
      bestScore = nextScore;
      bestFrequency = nextFrequency;
    }
  }

  var refinedFrequency = bestFrequency;
  if (bestCandidate > 0u && bestCandidate + 1u < candidateCount) {
    let centerScore = refinementScore(windowIndex, bestFrequency);
    let previousScore = refinementScore(windowIndex, bestFrequency / fineStepRatio);
    let nextScore = refinementScore(windowIndex, bestFrequency * fineStepRatio);
    let denominator = previousScore - 2.0 * centerScore + nextScore;
    if (abs(denominator) > 0.000001) {
      let offset = clamp(
        0.5 * (previousScore - nextScore) / denominator,
        -1.0,
        1.0,
      );
      refinedFrequency = bestFrequency *
        exp2(offset * params.candidateStepCents * 0.5 / 1200.0);
    }
  }

  rawOutput[windowIndex] = refinedFrequency;
}
`;
