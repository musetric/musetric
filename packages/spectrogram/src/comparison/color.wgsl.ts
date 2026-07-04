export const colorShader = `
struct ColorParams {
  windowCount: u32,
  referenceBaseSlot: u32,
  targetBaseSlot: u32,
  screenBase: u32,
  columnCount: u32,
  colorWindowLeft: u32,
  colorWindowRight: u32,
  colorFalloffSigma: f32,
};

@group(0) @binding(0) var<storage, read> referenceLine: array<f32>;
@group(0) @binding(1) var<storage, read> targetLine: array<f32>;
@group(0) @binding(2) var<storage, read_write> verdict: array<vec2<f32>>;
@group(0) @binding(3) var<uniform> params: ColorParams;

fn centsDistance(frequency: f32, targetFrequency: f32) -> f32 {
  if (frequency <= 0.0 || targetFrequency <= 0.0) {
    return 100000.0;
  }

  return abs(1200.0 * log2(frequency / targetFrequency));
}

fn referenceSlot(screenIndex: i32) -> u32 {
  return (params.referenceBaseSlot + u32(screenIndex)) % params.windowCount;
}

fn targetSlot(screenIndex: i32) -> u32 {
  return (params.targetBaseSlot + u32(screenIndex)) % params.windowCount;
}

@compute @workgroup_size(64)
fn colorize(@builtin(global_invocation_id) gid: vec3<u32>) {
  let localColumn = gid.x;
  if (localColumn >= params.columnCount) {
    return;
  }
  let screenIndex = i32(params.screenBase + localColumn);
  let writeSlot = targetSlot(screenIndex);

  let sigma = max(params.colorFalloffSigma, 0.0001);
  let left = i32(params.colorWindowLeft);
  let right = i32(params.colorWindowRight);

  var errorSum = 0.0;
  var errorWeight = 0.0;
  var missSum = 0.0;
  var voicedWeight = 0.0;

  for (var offset = -left; offset <= right; offset += 1) {
    let neighbor = screenIndex + offset;
    if (neighbor < 0 || neighbor >= i32(params.windowCount)) {
      continue;
    }

    let targetFrequency = targetLine[targetSlot(neighbor)];
    if (targetFrequency <= 0.0) {
      continue;
    }

    let normalized = f32(offset) / sigma;
    let weight = exp(-0.5 * normalized * normalized);
    voicedWeight += weight;

    let referenceFrequency = referenceLine[referenceSlot(neighbor)];
    if (referenceFrequency > 0.0) {
      errorSum += weight * centsDistance(targetFrequency, referenceFrequency);
      errorWeight += weight;
    } else {
      missSum += weight;
    }
  }

  var smoothedError = 0.0;
  if (errorWeight > 0.0) {
    smoothedError = errorSum / errorWeight;
  }
  var timingMiss = 0.0;
  if (voicedWeight > 0.0) {
    timingMiss = missSum / voicedWeight;
  }

  verdict[writeSlot] = vec2<f32>(smoothedError, timingMiss);
}
`;
