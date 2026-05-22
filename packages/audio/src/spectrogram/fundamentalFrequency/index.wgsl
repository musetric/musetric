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
  pad0: u32,
  pad1: u32,
};

@group(0) @binding(0) var<storage, read> signal: array<f32>;
@group(0) @binding(1) var<storage, read_write> output: array<f32>;
@group(0) @binding(2) var<uniform> params: FundamentalFrequencyParams;

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

fn harmonicPatternScore(windowIndex: u32, frequency: f32) -> f32 {
  let fundamentalIntensity = sampleIntensity(windowIndex, frequency);
  var weightedIntensity = fundamentalIntensity * 1.4;
  var totalWeight = 1.4;

  for (var harmonic = 2u; harmonic <= params.harmonicCount; harmonic += 1u) {
    let harmonicFrequency = frequency * f32(harmonic);
    if (harmonicFrequency >= params.sampleRate * 0.5) {
      break;
    }

    let weight = 1.0 / pow(f32(harmonic), 0.82);
    weightedIntensity += sampleIntensity(windowIndex, harmonicFrequency) * weight;
    totalWeight += weight;
  }

  return weightedIntensity / totalWeight;
}

fn interharmonicPatternScore(windowIndex: u32, frequency: f32) -> f32 {
  var weightedIntensity = 0.0;
  var totalWeight = 0.0;

  for (var harmonic = 1u; harmonic < params.harmonicCount; harmonic += 1u) {
    let harmonicFrequency = frequency * (f32(harmonic) + 0.5);
    if (harmonicFrequency >= params.sampleRate * 0.5) {
      break;
    }

    let weight = 1.0 / pow(f32(harmonic), 0.82);
    weightedIntensity += sampleIntensity(windowIndex, harmonicFrequency) * weight;
    totalWeight += weight;
  }

  if (totalWeight <= 0.0) {
    return 0.0;
  }

  return weightedIntensity / totalWeight;
}

fn harmonicSupportCount(windowIndex: u32, frequency: f32) -> u32 {
  var count = 0u;
  let threshold = params.minimumFundamentalIntensity * 1.25;

  for (var harmonic = 1u; harmonic <= 8u; harmonic += 1u) {
    let harmonicFrequency = frequency * f32(harmonic);
    if (harmonicFrequency >= params.sampleRate * 0.5) {
      break;
    }

    if (sampleIntensity(windowIndex, harmonicFrequency) >= threshold) {
      count += 1u;
    }
  }

  return count;
}

fn minimumScoreForFrequency(frequency: f32) -> f32 {
  if (frequency >= 520.0) {
    return params.minimumScore + 0.08;
  }

  if (frequency >= 360.0) {
    return params.minimumScore + 0.03;
  }

  return params.minimumScore;
}

fn hasReliableHarmonicSupport(
  frequency: f32,
  fundamentalIntensity: f32,
  score: f32,
  noiseScore: f32,
  supportCount: u32,
) -> bool {
  if (
    frequency < 140.0 &&
    fundamentalIntensity < params.minimumFundamentalIntensity * 5.8
  ) {
    return false;
  }

  if (supportCount >= 3u) {
    return true;
  }

  if (
    supportCount >= 2u &&
    frequency < 520.0 &&
    fundamentalIntensity >= params.minimumFundamentalIntensity * 3.5 &&
    score >= minimumScoreForFrequency(frequency) + 0.055 &&
    score >= noiseScore * 1.3 + 0.06
  ) {
    return true;
  }

  return (
    supportCount >= 1u &&
    frequency < 360.0 &&
    fundamentalIntensity >= params.minimumFundamentalIntensity * 5.5 &&
    score >= minimumScoreForFrequency(frequency) + 0.06 &&
    score >= noiseScore * 1.5 + 0.08
  );
}

fn minimumSubharmonicFundamentalRatio(frequency: f32) -> f32 {
  if (frequency < 150.0) {
    return 0.55;
  }

  if (frequency < 220.0) {
    return 0.45;
  }

  return 0.25;
}

fn harmonicScore(windowIndex: u32, frequency: f32) -> f32 {
  let fundamentalIntensity = sampleIntensity(windowIndex, frequency);
  if (fundamentalIntensity < params.minimumFundamentalIntensity) {
    return 0.0;
  }

  let score = harmonicPatternScore(windowIndex, frequency);
  if (score < minimumScoreForFrequency(frequency)) {
    return 0.0;
  }

  let noiseScore = interharmonicPatternScore(windowIndex, frequency);
  let supportCount = harmonicSupportCount(windowIndex, frequency);
  if (
    !hasReliableHarmonicSupport(
      frequency,
      fundamentalIntensity,
      score,
      noiseScore,
      supportCount,
    )
  ) {
    return 0.0;
  }

  if (score < noiseScore * 1.12 + 0.025) {
    return 0.0;
  }

  if (isWeakSubtone(windowIndex, frequency, fundamentalIntensity, score)) {
    return 0.0;
  }

  return score;
}

fn isWeakSubtone(
  windowIndex: u32,
  frequency: f32,
  fundamentalIntensity: f32,
  score: f32,
) -> bool {
  if (frequency >= 180.0) {
    return false;
  }

  let doubleFrequency = frequency * 2.0;
  if (doubleFrequency >= params.sampleRate * 0.5) {
    return false;
  }

  let doubleIntensity = sampleIntensity(windowIndex, doubleFrequency);
  if (
    doubleIntensity >= 0.65 &&
    doubleIntensity >= fundamentalIntensity * 1.25
  ) {
    let doubleScore = harmonicPatternScore(windowIndex, doubleFrequency);
    if (doubleScore >= score * 0.75) {
      return true;
    }
  }

  var upperScore = 0.0;

  for (var upperIndex = 0u; upperIndex <= 20u; upperIndex += 1u) {
    let ratio = 1.75 + f32(upperIndex) * 0.025;
    if (abs(ratio - 2.0) <= 0.08) {
      continue;
    }

    let candidateFrequency = frequency * ratio;
    if (candidateFrequency >= params.sampleRate * 0.5) {
      continue;
    }

    let candidateIntensity = sampleIntensity(windowIndex, candidateFrequency);
    if (
      candidateIntensity < 0.65 ||
      candidateIntensity < fundamentalIntensity * 1.18
    ) {
      continue;
    }

    let candidateScore = harmonicPatternScore(windowIndex, candidateFrequency);
    if (candidateScore <= upperScore) {
      continue;
    }

    upperScore = candidateScore;
  }

  return upperScore >= score * 0.84;
}

fn correctedSubharmonicFrequency(
  windowIndex: u32,
  frequency: f32,
  score: f32,
) -> f32 {
  var correctedFrequency = frequency;
  var correctedPriority = 0.0;
  var rejectedAsOvertone = false;
  let fundamentalIntensity = sampleIntensity(windowIndex, frequency);

  for (var divisor = 2u; divisor <= 4u; divisor += 1u) {
    let subharmonicFrequency = frequency / f32(divisor);
    if (subharmonicFrequency < params.minimumFrequency) {
      break;
    }

    let subharmonicFundamentalIntensity = sampleIntensity(
      windowIndex,
      subharmonicFrequency,
    );
    let subharmonicScore = harmonicPatternScore(
      windowIndex,
      subharmonicFrequency,
    );
    let subharmonicNoiseScore = interharmonicPatternScore(
      windowIndex,
      subharmonicFrequency,
    );
    let subharmonicSupportCount = harmonicSupportCount(
      windowIndex,
      subharmonicFrequency,
    );
    let hasSubharmonicSupport = hasReliableHarmonicSupport(
      subharmonicFrequency,
      subharmonicFundamentalIntensity,
      subharmonicScore,
      subharmonicNoiseScore,
      subharmonicSupportCount,
    );
    let isWeakSubharmonic = isWeakSubtone(
      windowIndex,
      subharmonicFrequency,
      subharmonicFundamentalIntensity,
      subharmonicScore,
    );
    if (
      hasSubharmonicSupport &&
      !isWeakSubharmonic &&
      subharmonicScore >= score * 0.72 &&
      subharmonicFundamentalIntensity >=
        params.minimumFundamentalIntensity * 1.4 &&
      subharmonicFundamentalIntensity >=
        fundamentalIntensity *
          minimumSubharmonicFundamentalRatio(subharmonicFrequency)
    ) {
      let priority = subharmonicScore * (1.0 + f32(divisor) * 0.08);
      if (priority <= correctedPriority) {
        continue;
      }

      correctedFrequency = subharmonicFrequency;
      correctedPriority = priority;
    }

    if (
      correctedPriority <= 0.0 &&
      frequency >= 520.0 &&
      subharmonicScore >= score * 0.52 &&
      subharmonicSupportCount >= 2u
    ) {
      rejectedAsOvertone = true;
    }
  }

  if (correctedPriority <= 0.0 && rejectedAsOvertone) {
    return 0.0;
  }

  return correctedFrequency;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let windowIndex = gid.x;
  if (windowIndex >= params.windowCount) {
    return;
  }

  var bestFrequency = 0.0;
  var bestScore = 0.0;
  var bestCandidate = 0u;

  for (var candidate = 0u; candidate < params.candidateCount; candidate += 1u) {
    let cents = f32(candidate) * params.candidateStepCents;
    let frequency = params.minimumFrequency * exp2(cents / 1200.0);
    let score = harmonicScore(windowIndex, frequency);

    if (score > bestScore) {
      bestScore = score;
      bestFrequency = frequency;
      bestCandidate = candidate;
    }
  }

  if (bestScore < params.minimumScore) {
    output[windowIndex] = 0.0;
    return;
  }

  let correctedFrequency = correctedSubharmonicFrequency(
    windowIndex,
    bestFrequency,
    bestScore,
  );
  var refinedFrequency = correctedFrequency;
  if (bestCandidate > 0u && bestCandidate + 1u < params.candidateCount) {
    let stepRatio = exp2(params.candidateStepCents / 1200.0);
    let centerScore = harmonicPatternScore(windowIndex, correctedFrequency);
    let previousScore = harmonicPatternScore(
      windowIndex,
      correctedFrequency / stepRatio,
    );
    let nextScore = harmonicPatternScore(
      windowIndex,
      correctedFrequency * stepRatio,
    );
    let denominator = previousScore - 2.0 * centerScore + nextScore;
    if (abs(denominator) > 0.000001) {
      let offset = clamp(
        0.5 * (previousScore - nextScore) / denominator,
        -1.0,
        1.0,
      );
      refinedFrequency = correctedFrequency *
        exp2(offset * params.candidateStepCents / 1200.0);
    }
  }

  output[windowIndex] = refinedFrequency;
}
