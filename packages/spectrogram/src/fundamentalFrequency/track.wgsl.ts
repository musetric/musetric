export const trackShader = `
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

@group(0) @binding(0) var<storage, read> lattice: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read_write> line: array<f32>;
@group(0) @binding(2) var<uniform> params: FundamentalFrequencyParams;

const maxStates = 9u;
const maxWindow = 16;
const infinity = 1.0e30;

fn centsDistance(frequency: f32, targetFrequency: f32) -> f32 {
  if (frequency <= 0.0 || targetFrequency <= 0.0) {
    return 100000.0;
  }

  return abs(1200.0 * log2(frequency / targetFrequency));
}

fn slotAtScreen(index: i32) -> u32 {
  return (params.baseSlot + u32(index)) % params.windowCount;
}

fn loadColumn(
  screenIndex: i32,
  latticeCount: u32,
  freqs: ptr<function, array<f32, 9>>,
  emits: ptr<function, array<f32, 9>>,
) {
  for (var state = 0u; state < latticeCount; state += 1u) {
    (*freqs)[state] = 0.0;
    (*emits)[state] = infinity;
  }
  if (screenIndex >= 0 && screenIndex < i32(params.windowCount)) {
    let base = slotAtScreen(screenIndex) * latticeCount;
    for (var state = 0u; state < latticeCount; state += 1u) {
      let entry = lattice[base + state];
      if (entry.y > 0.0) {
        (*freqs)[state] = entry.x;
        (*emits)[state] = -entry.y;
      }
    }
  }
  (*freqs)[latticeCount] = -1.0;
  (*emits)[latticeCount] = -params.unvoicedCost;
}

fn transitionCost(freqA: f32, freqB: f32) -> f32 {
  let aVoiced = freqA > 0.0;
  let bVoiced = freqB > 0.0;
  if (aVoiced && bVoiced) {
    return params.jumpCostCents * centsDistance(freqA, freqB);
  }
  if (aVoiced || bVoiced) {
    return params.voicedTransitionCost;
  }
  return 0.0;
}

@compute @workgroup_size(64)
fn track(@builtin(global_invocation_id) gid: vec3<u32>) {
  let localWindowIndex = gid.x;
  if (localWindowIndex >= params.columnCount) {
    return;
  }
  let windowIndex = (params.slotOffset + localWindowIndex) % params.windowCount;
  let centerScreen = i32(params.screenBase + localWindowIndex);
  let latticeCount = min(params.latticeCount, maxStates - 1u);
  let stateCount = latticeCount + 1u;
  let window = min(i32(params.trackWindow), maxWindow);

  var curFreq = array<f32, 9>();
  var curEmit = array<f32, 9>();
  var prevFreq = array<f32, 9>();
  var alpha = array<f32, 9>();
  var scratch = array<f32, 9>();

  loadColumn(centerScreen - window, latticeCount, &curFreq, &curEmit);
  for (var state = 0u; state < stateCount; state += 1u) {
    alpha[state] = curEmit[state];
    prevFreq[state] = curFreq[state];
  }
  for (var step = 1; step <= window; step += 1) {
    loadColumn(centerScreen - window + step, latticeCount, &curFreq, &curEmit);
    for (var b = 0u; b < stateCount; b += 1u) {
      var best = infinity;
      for (var a = 0u; a < stateCount; a += 1u) {
        let cost = alpha[a] + transitionCost(prevFreq[a], curFreq[b]);
        best = min(best, cost);
      }
      scratch[b] = curEmit[b] + best;
    }
    for (var state = 0u; state < stateCount; state += 1u) {
      alpha[state] = scratch[state];
      prevFreq[state] = curFreq[state];
    }
  }

  var centerFreq = array<f32, 9>();
  var alphaCenter = array<f32, 9>();
  for (var state = 0u; state < stateCount; state += 1u) {
    centerFreq[state] = curFreq[state];
    alphaCenter[state] = alpha[state];
  }

  var rightFreq = array<f32, 9>();
  var rightEmit = array<f32, 9>();
  var beta = array<f32, 9>();
  loadColumn(centerScreen + window, latticeCount, &rightFreq, &rightEmit);
  for (var state = 0u; state < stateCount; state += 1u) {
    beta[state] = 0.0;
  }
  for (var step = 1; step <= window; step += 1) {
    loadColumn(centerScreen + window - step, latticeCount, &curFreq, &curEmit);
    for (var a = 0u; a < stateCount; a += 1u) {
      var best = infinity;
      for (var b = 0u; b < stateCount; b += 1u) {
        let cost = transitionCost(curFreq[a], rightFreq[b]) +
          rightEmit[b] + beta[b];
        best = min(best, cost);
      }
      scratch[a] = best;
    }
    for (var state = 0u; state < stateCount; state += 1u) {
      beta[state] = scratch[state];
      rightFreq[state] = curFreq[state];
      rightEmit[state] = curEmit[state];
    }
  }

  var bestState = latticeCount;
  var bestCost = infinity;
  for (var state = 0u; state < stateCount; state += 1u) {
    let cost = alphaCenter[state] + beta[state];
    if (cost < bestCost) {
      bestCost = cost;
      bestState = state;
    }
  }

  var result = 0.0;
  if (bestState < latticeCount) {
    result = centerFreq[bestState];
  }
  line[windowIndex] = result;
}
`;
