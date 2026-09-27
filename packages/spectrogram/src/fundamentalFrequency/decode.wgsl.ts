import { centsDistanceWgsl } from '../common/centsDistance.wgsl.js';
import { pitchParamsStruct } from './paramsStruct.wgsl.js';
import { pitchDecodedStruct, pitchObservationStruct } from './slots.wgsl.js';

export const decodeShader = `
${pitchParamsStruct}
${pitchObservationStruct}
${pitchDecodedStruct}

@group(0) @binding(0) var<storage, read> observations: array<PitchObservation>;
@group(0) @binding(1) var<storage, read_write> decoded: array<PitchDecoded>;
@group(0) @binding(2) var<uniform> params: PitchParams;

const stateCount = 6u;
const unvoiced = 5u;
const infinity = 1.0e30;
const maxHistory = 128;

${centsDistanceWgsl}

struct Column {
  freqs: array<f32, 6>,
  emits: array<f32, 6>,
};

fn loadColumn(frame: i32) -> Column {
  var column: Column;
  for (var state = 0u; state < unvoiced; state += 1u) {
    column.freqs[state] = 0.0;
    column.emits[state] = infinity;
  }
  column.freqs[unvoiced] = -1.0;
  column.emits[unvoiced] = -params.unvoicedCost;
  if (frame < 0 || frame >= params.trackFrames) {
    return column;
  }
  let observation = observations[u32(frame) % params.ringFrames];
  if (observation.frame != frame) {
    return column;
  }
  for (var state = 0u; state < unvoiced; state += 1u) {
    let candidate = observation.candidates[state];
    if (candidate.y > 0.0) {
      column.freqs[state] = candidate.x;
      column.emits[state] = -candidate.y;
    }
  }
  column.emits[unvoiced] = -params.unvoicedCost +
    params.voicingScale * (2.0 * observation.voicing - 1.0);
  return column;
}

fn jumpCost(freqA: f32, freqB: f32) -> f32 {
  return params.jumpCostCents *
    min(centsDistance(freqA, freqB), params.jumpCapCents);
}

fn memoryCost(remembered: f32, frequency: f32, gap: f32) -> f32 {
  if (remembered <= 0.0 || frequency <= 0.0 || params.memoryWeight <= 0.0) {
    return 0.0;
  }
  let decay = exp(-gap / max(params.memoryDecayFrames, 1.0));
  return params.memoryWeight *
    min(centsDistance(remembered, frequency), params.memoryCapCents) * decay;
}

@compute @workgroup_size(64)
fn decode(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= params.decodeCount) {
    return;
  }
  let frame = params.decodeFirst + i32(gid.x);
  let history = min(i32(params.historyFrames), maxHistory);
  let lookahead = min(i32(params.lookaheadFrames), history);

  var column = loadColumn(frame - history);
  var alpha = column.emits;
  var previousFreqs = column.freqs;
  var memoryFreq = 0.0;
  var memoryGap = 0.0;
  var scratch = array<f32, 6>();
  for (var step = 1; step <= history; step += 1) {
    column = loadColumn(frame - history + step);
    var nextMemoryFreq = memoryFreq;
    var nextMemoryGap = memoryGap + 1.0;
    for (var b = 0u; b < stateCount; b += 1u) {
      var best = infinity;
      if (b == unvoiced) {
        best = alpha[unvoiced];
        for (var a = 0u; a < unvoiced; a += 1u) {
          let cost = alpha[a] + params.voicedTransitionCost;
          if (cost < best) {
            best = cost;
            nextMemoryFreq = previousFreqs[a];
            nextMemoryGap = 1.0;
          }
        }
      } else {
        for (var a = 0u; a < unvoiced; a += 1u) {
          best = min(best, alpha[a] + jumpCost(previousFreqs[a], column.freqs[b]));
        }
        best = min(
          best,
          alpha[unvoiced] + params.voicedTransitionCost +
            memoryCost(memoryFreq, column.freqs[b], memoryGap),
        );
      }
      scratch[b] = column.emits[b] + best;
    }
    alpha = scratch;
    previousFreqs = column.freqs;
    memoryFreq = nextMemoryFreq;
    memoryGap = nextMemoryGap;
  }
  let centerFreqs = column.freqs;
  let alphaCenter = alpha;

  var right = loadColumn(frame + lookahead);
  var beta = array<f32, 6>();
  var nextFreq = 0.0;
  var nextGap = 0.0;
  for (var step = 1; step <= lookahead; step += 1) {
    let current = loadColumn(frame + lookahead - step);
    var newNextFreq = nextFreq;
    var newNextGap = nextGap + 1.0;
    for (var a = 0u; a < stateCount; a += 1u) {
      var best = infinity;
      if (a == unvoiced) {
        best = right.emits[unvoiced] + beta[unvoiced];
        for (var b = 0u; b < unvoiced; b += 1u) {
          let cost = params.voicedTransitionCost + right.emits[b] + beta[b];
          if (cost < best) {
            best = cost;
            newNextFreq = right.freqs[b];
            newNextGap = 1.0;
          }
        }
      } else {
        for (var b = 0u; b < unvoiced; b += 1u) {
          best = min(best, jumpCost(current.freqs[a], right.freqs[b]) + right.emits[b] + beta[b]);
        }
        best = min(
          best,
          params.voicedTransitionCost +
            memoryCost(current.freqs[a], nextFreq, nextGap) +
            right.emits[unvoiced] + beta[unvoiced],
        );
      }
      scratch[a] = best;
    }
    beta = scratch;
    right = current;
    nextFreq = newNextFreq;
    nextGap = newNextGap;
  }

  var bestState = unvoiced;
  var bestCost = infinity;
  var bestVoiced = infinity;
  var secondVoiced = infinity;
  for (var state = 0u; state < stateCount; state += 1u) {
    var cost = alphaCenter[state] + beta[state];
    if (state == unvoiced) {
      cost += memoryCost(memoryFreq, nextFreq, memoryGap + nextGap);
    } else if (cost < bestVoiced) {
      secondVoiced = bestVoiced;
      bestVoiced = cost;
    } else if (cost < secondVoiced) {
      secondVoiced = cost;
    }
    if (cost < bestCost) {
      bestCost = cost;
      bestState = state;
    }
  }
  let unvoicedTotal = alphaCenter[unvoiced] + beta[unvoiced] +
    memoryCost(memoryFreq, nextFreq, memoryGap + nextGap);
  var margin = abs(unvoicedTotal - bestVoiced);
  var frequency = 0.0;
  if (bestState < unvoiced) {
    frequency = centerFreqs[bestState];
    margin = secondVoiced - bestVoiced;
  }
  var result: PitchDecoded;
  result.frequency = frequency;
  result.confidence = 1.0 - exp(-min(margin, 1.0e6) / max(params.confidenceScale, 1.0e-6));
  result.frame = frame;
  result.padding = 0u;
  decoded[u32(frame) % params.ringFrames] = result;
}
`;
