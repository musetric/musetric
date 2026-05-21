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

@group(0) @binding(0) var<storage, read> rawOutput: array<f32>;
@group(0) @binding(1) var<storage, read_write> filteredOutput: array<f32>;
@group(0) @binding(2) var<uniform> params: FundamentalFrequencyParams;

fn frequencyAt(index: i32) -> f32 {
  if (index < 0 || index >= i32(params.windowCount)) {
    return 0.0;
  }

  return rawOutput[u32(index)];
}

fn centsDistance(frequency: f32, targetFrequency: f32) -> f32 {
  if (frequency <= 0.0 || targetFrequency <= 0.0) {
    return 100000.0;
  }

  return abs(1200.0 * log2(frequency / targetFrequency));
}

fn countCompatibleNeighbors(windowIndex: i32, frequency: f32) -> u32 {
  var count = 0u;
  for (var offset = -6i; offset <= 6i; offset += 1i) {
    if (offset == 0i) {
      continue;
    }

    let neighborFrequency = frequencyAt(windowIndex + offset);
    if (centsDistance(frequency, neighborFrequency) <= 160.0) {
      count += 1u;
    }
  }

  return count;
}

fn nearestPreviousFrequency(windowIndex: i32) -> f32 {
  for (var offset = 1i; offset <= 6i; offset += 1i) {
    let frequency = frequencyAt(windowIndex - offset);
    if (frequency > 0.0) {
      return frequency;
    }
  }

  return 0.0;
}

fn nearestNextFrequency(windowIndex: i32) -> f32 {
  for (var offset = 1i; offset <= 6i; offset += 1i) {
    let frequency = frequencyAt(windowIndex + offset);
    if (frequency > 0.0) {
      return frequency;
    }
  }

  return 0.0;
}

fn isUnsupportedJump(windowIndex: i32, frequency: f32) -> bool {
  let previousFrequency = nearestPreviousFrequency(windowIndex);
  let nextFrequency = nearestNextFrequency(windowIndex);
  if (previousFrequency <= 0.0 || nextFrequency <= 0.0) {
    return false;
  }

  let neighborDistance = centsDistance(previousFrequency, nextFrequency);
  let previousDistance = centsDistance(frequency, previousFrequency);
  let nextDistance = centsDistance(frequency, nextFrequency);
  return (
    neighborDistance <= 220.0 &&
    previousDistance >= 360.0 &&
    nextDistance >= 360.0
  );
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let windowIndex = gid.x;
  if (windowIndex >= params.windowCount) {
    return;
  }

  let frequency = rawOutput[windowIndex];
  if (frequency <= 0.0) {
    filteredOutput[windowIndex] = 0.0;
    return;
  }

  let index = i32(windowIndex);
  if (countCompatibleNeighbors(index, frequency) <= 4u) {
    filteredOutput[windowIndex] = 0.0;
    return;
  }

  if (isUnsupportedJump(index, frequency)) {
    filteredOutput[windowIndex] = 0.0;
    return;
  }

  filteredOutput[windowIndex] = frequency;
}
