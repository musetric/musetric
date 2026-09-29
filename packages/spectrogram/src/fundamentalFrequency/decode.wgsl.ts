import { centsDistanceWgsl } from '../common/centsDistance.wgsl.js';
import { pitchParamsStruct } from './paramsStruct.wgsl.js';
import { pitchLatticeCount } from './settings.es.js';
import { pitchDecodedStruct, pitchObservationStruct } from './slots.wgsl.js';

const voiced = Array.from({ length: pitchLatticeCount }, (_, state) => state);
const states = [...voiced, pitchLatticeCount];

const joinLines = (items: string[]): string => items.join('\n');

const forwardFrom = (to: number, from: number): string =>
  `  best${to} = min(best${to}, alpha${from} + jumpCost(previous${from}, column.frequency${to}));`;

const forwardVoiced = (to: number): string =>
  joinLines([
    `  var best${to} = infinity;`,
    ...voiced.map((from) => forwardFrom(to, from)),
    `  best${to} = min(best${to}, alpha${pitchLatticeCount} + params.voicedTransitionCost);`,
    `  let next${to} = column.emit${to} + best${to};`,
  ]);

const forwardUnvoiced = (): string =>
  joinLines([
    `  var best${pitchLatticeCount} = alpha${pitchLatticeCount};`,
    ...voiced.map(
      (from) =>
        `  best${pitchLatticeCount} = min(best${pitchLatticeCount}, alpha${from} + params.voicedTransitionCost);`,
    ),
    `  let next${pitchLatticeCount} = column.emit${pitchLatticeCount} + best${pitchLatticeCount};`,
  ]);

const forwardStep = joinLines([
  ...voiced.map(forwardVoiced),
  forwardUnvoiced(),
  ...states.map((state) => `  alpha${state} = next${state};`),
  ...voiced.map((state) => `  previous${state} = column.frequency${state};`),
]);

const backwardTo = (from: number, to: number): string =>
  `  best${from} = min(best${from}, jumpCost(current.frequency${from}, right.frequency${to}) + right.emit${to} + beta${to});`;

const backwardVoiced = (from: number): string =>
  joinLines([
    `  var best${from} = infinity;`,
    ...voiced.map((to) => backwardTo(from, to)),
    `  best${from} = min(best${from}, params.voicedTransitionCost + right.emit${pitchLatticeCount} + beta${pitchLatticeCount});`,
  ]);

const backwardUnvoiced = (): string =>
  joinLines([
    `  var best${pitchLatticeCount} = right.emit${pitchLatticeCount} + beta${pitchLatticeCount};`,
    ...voiced.map(
      (to) =>
        `  best${pitchLatticeCount} = min(best${pitchLatticeCount}, params.voicedTransitionCost + right.emit${to} + beta${to});`,
    ),
  ]);

const backwardStep = joinLines([
  ...voiced.map(backwardVoiced),
  backwardUnvoiced(),
  ...states.map((state) => `  beta${state} = best${state};`),
]);

const readCandidate = (state: number): string =>
  joinLines([
    `  if (observation.candidates[${state}].y > 0.0) {`,
    `    column.frequency${state} = observation.candidates[${state}].x;`,
    `    column.emit${state} = -observation.candidates[${state}].y;`,
    '  }',
  ]);

const columnFields = joinLines([
  ...voiced.map((state) => `  frequency${state}: f32,`),
  ...states.map((state) => `  emit${state}: f32,`),
]);

const columnDefaults = joinLines(
  voiced.map(
    (state) =>
      `  column.frequency${state} = 0.0;\n  column.emit${state} = infinity;`,
  ),
);

const alphaStart = joinLines([
  ...states.map((state) => `  var alpha${state} = column.emit${state};`),
  ...voiced.map(
    (state) => `  var previous${state} = column.frequency${state};`,
  ),
]);

const betaStart = joinLines(states.map((state) => `  var beta${state} = 0.0;`));

const totalCosts = states
  .map((state) => `alpha${state} + beta${state}`)
  .join(', ');

const centerFrequencies = voiced
  .map((state) => `center.frequency${state}`)
  .join(', ');

export const decodeShader = `
${pitchParamsStruct}
${pitchObservationStruct}
${pitchDecodedStruct}

@group(0) @binding(0) var<storage, read> observations: array<PitchObservation>;
@group(0) @binding(1) var<storage, read_write> decoded: array<PitchDecoded>;
@group(0) @binding(2) var<uniform> params: PitchParams;

const unvoiced = ${pitchLatticeCount}u;
const infinity = 1.0e30;
const maxHistory = 128;

${centsDistanceWgsl}

struct Column {
${columnFields}
};

fn loadColumn(frame: i32) -> Column {
  var column: Column;
${columnDefaults}
  column.emit${pitchLatticeCount} = -params.unvoicedCost;
  if (frame < 0 || frame >= params.trackFrames) {
    return column;
  }
  let observation = observations[u32(frame) % params.ringFrames];
  if (observation.frame != frame) {
    return column;
  }
${joinLines(voiced.map(readCandidate))}
  column.emit${pitchLatticeCount} = -params.unvoicedCost +
    params.voicingScale * (2.0 * observation.voicing - 1.0);
  return column;
}

fn jumpCost(freqA: f32, freqB: f32) -> f32 {
  return params.jumpCostCents *
    min(centsDistance(freqA, freqB), params.jumpCapCents);
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
${alphaStart}
  for (var step = 1; step <= history; step += 1) {
    column = loadColumn(frame - history + step);
${forwardStep}
  }
  let center = column;

  var right = loadColumn(frame + lookahead);
${betaStart}
  for (var step = 1; step <= lookahead; step += 1) {
    let current = loadColumn(frame + lookahead - step);
${backwardStep}
    right = current;
  }

  let costs = array<f32, ${states.length}>(${totalCosts});
  let frequencies = array<f32, ${voiced.length}>(${centerFrequencies});
  var bestState = unvoiced;
  var bestCost = infinity;
  var bestVoiced = infinity;
  var secondVoiced = infinity;
  for (var state = 0u; state <= unvoiced; state += 1u) {
    let cost = costs[state];
    if (state < unvoiced) {
      if (cost < bestVoiced) {
        secondVoiced = bestVoiced;
        bestVoiced = cost;
      } else if (cost < secondVoiced) {
        secondVoiced = cost;
      }
    }
    if (cost < bestCost) {
      bestCost = cost;
      bestState = state;
    }
  }
  var margin = abs(costs[unvoiced] - bestVoiced);
  var frequency = 0.0;
  if (bestState < unvoiced) {
    frequency = frequencies[bestState];
    margin = secondVoiced - bestVoiced;
  }
  var result: PitchDecoded;
  result.frequency = frequency;
  result.confidence = 1.0 - exp(-min(margin, 1.0e6) / max(params.confidenceScale, 1.0e-6));
  result.frame = frame;
  result.raw = frequency;
  decoded[u32(frame) % params.ringFrames] = result;
}
`;
