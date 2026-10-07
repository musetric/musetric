import { fitRunSpan } from './runSpan.es.js';
import {
  createScheduleState,
  floorMod,
  invalidate,
  type PitchSampleRange,
  resetState,
  type ScheduleState,
} from './scheduleState.es.js';
import { type PitchSettings } from './settings.es.js';

const isObserved = (state: ScheduleState, frame: number, ring: number) => {
  const slot = floorMod(frame, ring);
  return state.observed[slot] === frame && state.observedFinal[slot] === 1;
};

export type PitchFrameRange = {
  first: number;
  count: number;
};

export type PitchSlot = {
  frame: number;
  spanOffset: number;
  predecessor: number;
  observe: boolean;
};

export type PitchSpan = {
  sampleStart: number;
  spanOffset: number;
  length: number;
};

export type PitchPlan = {
  slots: PitchSlot[];
  spans: PitchSpan[];
  decodes: PitchFrameRange[];
  smooth: PitchFrameRange;
  fold: PitchFrameRange;
  complete: boolean;
};

type RunPlanner = {
  settings: PitchSettings;
  plan: PitchPlan;
  spanEnd: number;
  position: (songFrame: number) => number;
};

const addRun = (
  planner: RunPlanner,
  first: number,
  count: number,
): PitchFrameRange | undefined => {
  const { settings, plan } = planner;
  const { batchSlots, maxRuns } = settings;
  const hasPredecessor = first > 0;
  const free = batchSlots - plan.slots.length;
  if (plan.spans.length >= maxRuns || free <= (hasPredecessor ? 1 : 0)) {
    return undefined;
  }
  const startFrame = hasPredecessor ? first - 1 : first;
  const span = fitRunSpan(
    planner,
    startFrame,
    first,
    Math.min(count, free - (hasPredecessor ? 1 : 0)),
  );
  if (!span) {
    return undefined;
  }
  const { taken, sampleStart, length } = span;
  const spanOffset = planner.spanEnd;
  plan.spans.push({ sampleStart, spanOffset, length });
  planner.spanEnd += length;
  if (hasPredecessor) {
    plan.slots.push({
      frame: startFrame,
      spanOffset,
      predecessor: -1,
      observe: false,
    });
  }
  for (let index = 0; index < taken; index += 1) {
    const frame = first + index;
    const slotIndex = plan.slots.length;
    plan.slots.push({
      frame,
      spanOffset: spanOffset + span.offsetOf(frame),
      predecessor: index > 0 || hasPredecessor ? slotIndex - 1 : -1,
      observe: true,
    });
  }
  return { first, count: taken };
};

export type PitchScheduleInput = {
  trackFrames: number;
  truncated: boolean;
  availableSamples: number;
  visibleFirst: number;
  visibleLast: number;
  invalidations: readonly PitchSampleRange[];
  reset: boolean;
  position: (songFrame: number) => number;
};

const observationRange = (
  settings: PitchSettings,
  input: PitchScheduleInput,
): PitchFrameRange => {
  const { historyFrames, lookaheadFrames, hop, support } = settings;
  const { smoothBackFrames, smoothAheadFrames } = settings;
  const { repairBackFrames, repairAheadFrames } = settings;
  const first = Math.max(
    0,
    input.visibleFirst - smoothBackFrames - repairBackFrames - historyFrames,
  );
  const recorded = input.truncated
    ? Math.floor((input.availableSamples + support - 1) / hop)
    : input.trackFrames - 1;
  const last = Math.min(
    input.trackFrames - 1,
    recorded,
    input.visibleLast + smoothAheadFrames + repairAheadFrames + lookaheadFrames,
  );
  return { first, count: last - first + 1 };
};

type ObservationPlan = {
  runs: PitchFrameRange[];
  complete: boolean;
};

const collectRuns = (
  state: ScheduleState,
  planner: RunPlanner,
  range: PitchFrameRange,
): ObservationPlan => {
  const { ringFrames } = planner.settings;
  const last = range.first + range.count - 1;
  const runs: PitchFrameRange[] = [];
  let frame = range.first;
  while (frame <= last) {
    if (isObserved(state, frame, ringFrames)) {
      frame += 1;
      continue;
    }
    let end = frame;
    while (end + 1 <= last && !isObserved(state, end + 1, ringFrames)) {
      end += 1;
    }
    const run = addRun(planner, frame, end - frame + 1);
    if (!run) {
      return { runs, complete: false };
    }
    runs.push(run);
    if (run.count < end - frame + 1) {
      return { runs, complete: false };
    }
    frame = run.first + run.count;
  }
  return { runs, complete: true };
};

const markObserved = (
  state: ScheduleState,
  settings: PitchSettings,
  input: PitchScheduleInput,
  runs: readonly PitchFrameRange[],
): boolean => {
  const { ringFrames, hop, support } = settings;
  let final = true;
  for (const run of runs) {
    for (let frame = run.first; frame < run.first + run.count; frame += 1) {
      const slot = floorMod(frame, ringFrames);
      const ready =
        !input.truncated ||
        input.position(frame * hop) + support <=
          input.position(input.availableSamples);
      state.observed[slot] = frame;
      state.observedFinal[slot] = ready ? 1 : 0;
      final &&= ready;
    }
  }
  return final;
};

const planObservations = (
  state: ScheduleState,
  settings: PitchSettings,
  input: PitchScheduleInput,
  plan: PitchPlan,
): ObservationPlan => {
  const planner: RunPlanner = {
    settings,
    plan,
    spanEnd: 0,
    position: input.position,
  };
  const collected = collectRuns(
    state,
    planner,
    observationRange(settings, input),
  );
  const final = markObserved(state, settings, input, collected.runs);
  return { runs: collected.runs, complete: collected.complete && final };
};

type DecodePlan = {
  decodes: PitchFrameRange[];
  complete: boolean;
};

const planDecodes = (
  state: ScheduleState,
  settings: PitchSettings,
  input: PitchScheduleInput,
  runs: readonly PitchFrameRange[],
): DecodePlan => {
  const { ringFrames, historyFrames, lookaheadFrames } = settings;
  const { smoothBackFrames, smoothAheadFrames } = settings;
  const { repairBackFrames, repairAheadFrames } = settings;
  const first = Math.max(
    0,
    input.visibleFirst - smoothBackFrames - repairBackFrames,
  );
  const last = Math.min(
    input.trackFrames - 1,
    input.visibleLast + smoothAheadFrames + repairAheadFrames,
  );
  if (last < first) {
    return { decodes: [], complete: true };
  }
  const windowFirst = first - historyFrames;
  const windowLast = last + lookaheadFrames;
  const ready = new Int32Array(windowLast - windowFirst + 2);
  for (let frame = windowFirst; frame <= windowLast; frame += 1) {
    const outside = frame < 0 || frame >= input.trackFrames;
    const observed = outside || isObserved(state, frame, ringFrames) ? 1 : 0;
    ready[frame - windowFirst + 1] = ready[frame - windowFirst] + observed;
  }
  const touched = new Uint8Array(last - first + 1);
  for (const run of runs) {
    const from = Math.max(first, run.first - lookaheadFrames);
    const to = Math.min(last, run.first + run.count - 1 + historyFrames);
    touched.fill(1, from - first, to - first + 1);
  }
  const decodes: PitchFrameRange[] = [];
  let complete = true;
  for (let frame = first; frame <= last; frame += 1) {
    const slot = floorMod(frame, ringFrames);
    const stale =
      state.decoded[slot] !== frame ||
      state.decodedFinal[slot] === 0 ||
      touched[frame - first] === 1;
    if (!stale) {
      continue;
    }
    const from = frame - historyFrames - windowFirst;
    const to = frame + lookaheadFrames - windowFirst + 1;
    state.decoded[slot] = frame;
    const final = ready[to] - ready[from] === to - from;
    state.decodedFinal[slot] = final ? 1 : 0;
    complete &&= final;
    const previous = decodes.at(-1);
    if (previous && previous.first + previous.count === frame) {
      previous.count += 1;
    } else {
      decodes.push({ first: frame, count: 1 });
    }
  }
  return { decodes, complete };
};

const smoothRange = (input: PitchScheduleInput): PitchFrameRange => {
  const first = Math.max(0, input.visibleFirst);
  const last = Math.min(input.trackFrames - 1, input.visibleLast);
  return { first, count: Math.max(0, last - first + 1) };
};

const foldRange = (
  settings: PitchSettings,
  input: PitchScheduleInput,
): PitchFrameRange => {
  const { smoothBackFrames, smoothAheadFrames, fillGapFrames } = settings;
  const first = Math.max(
    0,
    input.visibleFirst - smoothBackFrames - fillGapFrames - 1,
  );
  const last = Math.min(
    input.trackFrames - 1,
    input.visibleLast + smoothAheadFrames + fillGapFrames + 1,
  );
  return { first, count: Math.max(0, last - first + 1) };
};

export type PitchSchedule = {
  plan: (input: PitchScheduleInput) => PitchPlan;
};

export const createPitchSchedule = (settings: PitchSettings): PitchSchedule => {
  const state = createScheduleState(settings.ringFrames);
  return {
    plan: (input) => {
      if (input.reset) {
        resetState(state);
      }
      for (const invalidation of input.invalidations) {
        invalidate(state, settings, invalidation);
      }
      const plan: PitchPlan = {
        slots: [],
        spans: [],
        decodes: [],
        smooth: smoothRange(input),
        fold: foldRange(settings, input),
        complete: true,
      };
      const observations = planObservations(state, settings, input, plan);
      const decodes = planDecodes(state, settings, input, observations.runs);
      plan.decodes = decodes.decodes;
      plan.complete = observations.complete && decodes.complete;
      return plan;
    },
  };
};
