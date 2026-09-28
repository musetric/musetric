import { pitchParamsStruct } from './paramsStruct.wgsl.js';
import { pitchDecodedStruct, pitchObservationStruct } from './slots.wgsl.js';

export const foldShader = `
${pitchParamsStruct}
${pitchObservationStruct}
${pitchDecodedStruct}

@group(0) @binding(0) var<storage, read> decoded: array<PitchDecoded>;
@group(0) @binding(1) var<storage, read> observations: array<PitchObservation>;
@group(0) @binding(2) var<storage, read_write> folded: array<f32>;
@group(0) @binding(3) var<uniform> params: PitchParams;

const silentDb = -1000.0;

fn rawAt(frame: i32) -> f32 {
  if (frame < 0 || frame >= params.trackFrames) {
    return 0.0;
  }
  let index = u32(frame) % params.ringFrames;
  if (decoded[index].frame != frame) {
    return 0.0;
  }
  return max(decoded[index].raw, 0.0);
}

fn levelAt(frame: i32) -> f32 {
  if (frame < 0 || frame >= params.trackFrames) {
    return silentDb;
  }
  let observation = observations[u32(frame) % params.ringFrames];
  if (observation.frame != frame) {
    return silentDb;
  }
  return observation.level;
}

fn centsOf(frequency: f32) -> f32 {
  return 1200.0 * log2(frequency);
}

fn joined(earlier: i32, later: i32) -> bool {
  let a = rawAt(earlier);
  let b = rawAt(later);
  return a > 0.0 && b > 0.0 && abs(centsOf(a) - centsOf(b)) <= params.foldSplitCents;
}

fn anchored(first: i32, direction: i32) -> bool {
  for (var step = 1; step < i32(params.foldAnchorFrames); step += 1) {
    if (!joined(first + direction * (step - 1), first + direction * step)) {
      return false;
    }
  }
  return true;
}

fn neighborAbove(edge: i32, direction: i32) -> bool {
  let edgeCents = centsOf(rawAt(edge));
  for (var step = 1; step <= i32(params.foldGapFrames) + 1; step += 1) {
    let frame = edge + direction * step;
    let value = rawAt(frame);
    if (value <= 0.0) {
      continue;
    }
    return abs(centsOf(value) - edgeCents - 1200.0) <= params.foldToleranceCents &&
      anchored(frame, direction);
  }
  return false;
}

fn runEdge(frame: i32, direction: i32, limit: i32, split: f32) -> i32 {
  var edge = frame;
  var cents = centsOf(rawAt(frame));
  for (var step = 0; step < limit; step += 1) {
    let value = rawAt(edge + direction);
    if (value <= 0.0) {
      break;
    }
    let next = centsOf(value);
    if (abs(next - cents) > split) {
      break;
    }
    edge += direction;
    cents = next;
  }
  return edge;
}

fn nearPitch(frame: i32, cents: f32) -> bool {
  let value = rawAt(frame);
  return value > 0.0 && abs(centsOf(value) - cents) <= params.echoToleranceCents;
}

fn isEcho(frame: i32) -> bool {
  if (params.echoMaxFrames == 0u) {
    return false;
  }
  let reach = i32(params.echoMaxFrames);
  let start = runEdge(frame, -1, reach, params.echoSplitCents);
  let end = runEdge(frame, 1, reach - (frame - start), params.echoSplitCents);
  if (end - start + 1 > reach) {
    return false;
  }
  var sum = 0.0;
  var runLevel = silentDb;
  for (var index = start; index <= end; index += 1) {
    sum += centsOf(rawAt(index));
    runLevel = max(runLevel, levelAt(index));
  }
  let cents = sum / f32(end - start + 1);
  let gap = i32(params.echoGapFrames);
  var beforeLevel = silentDb;
  for (var step = 1; step <= gap; step += 1) {
    if (nearPitch(start - step, cents) || nearPitch(end + step, cents)) {
      return false;
    }
    beforeLevel = max(beforeLevel, levelAt(start - step));
  }
  if (runLevel > beforeLevel - params.echoOffsetDb) {
    return false;
  }
  var held = 0u;
  var heldLevel = silentDb;
  for (var index = start - i32(params.echoWindowFrames); index < start - gap; index += 1) {
    if (nearPitch(index, cents)) {
      held += 1u;
      heldLevel = max(heldLevel, levelAt(index));
    }
  }
  return held >= params.echoHeldFrames && runLevel <= heldLevel - params.echoDropDb;
}

fn foldedRaw(frame: i32) -> f32 {
  let raw = rawAt(frame);
  if (raw <= 0.0) {
    return raw;
  }
  if (isEcho(frame)) {
    return 0.0;
  }
  if (params.foldMaxFrames == 0u) {
    return raw;
  }
  let reach = i32(params.foldMaxFrames);
  let start = runEdge(frame, -1, reach, params.foldSplitCents);
  let end = runEdge(frame, 1, reach - (frame - start), params.foldSplitCents);
  if (end - start + 1 > reach) {
    return raw;
  }
  if (neighborAbove(start, -1) || neighborAbove(end, 1)) {
    return 2.0 * raw;
  }
  return raw;
}

@compute @workgroup_size(64)
fn foldPitch(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= params.foldCount) {
    return;
  }
  let frame = params.foldFirst + i32(gid.x);
  folded[u32(frame) % params.ringFrames] = foldedRaw(frame);
}
`;
