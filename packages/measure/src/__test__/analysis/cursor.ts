import { type CursorRun } from '../runs.js';

const startupMs = 400;
const declaredJumpMs = 300;
const standingMs = 500;
const seekReachSeconds = 0.25;
const stopSettleMs = 700;

const median = (values: readonly number[]) => {
  if (values.length === 0) {
    return 0;
  }
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
};

type Sample = { time: number; frame: number; playing: boolean };

const longestStand = (samples: readonly Sample[]) => {
  let longest = 0;
  let from = 0;
  for (let index = 1; index < samples.length; index += 1) {
    if (
      samples[index].frame !== samples[from].frame ||
      !samples[index].playing
    ) {
      from = index;
      continue;
    }
    longest = Math.max(longest, samples[index].time - samples[from].time);
  }
  return longest;
};

const between = (samples: readonly Sample[], from: number, to: number) =>
  samples.filter((sample) => sample.time > from && sample.time < to);

type CursorEvent = CursorRun['events'][number];

type Trace = {
  samples: Sample[];
  events: CursorEvent[];
  sampleRate: number;
  loop: CursorRun['loop'];
  screenFrameMs: number;
  toMs: (frames: number) => number;
  windowOf: (index: number) => Sample[];
};

const toTrace = (run: CursorRun): Trace => {
  const { sampleRate, loop, events } = run;
  const samples = run.frames.map((entry) => {
    const [time, frame, playing] = entry;
    return { time, frame, playing: playing === 1 };
  });
  const end = samples.at(-1)?.time ?? 0;
  return {
    samples,
    events,
    sampleRate,
    loop,
    screenFrameMs: median(
      samples
        .slice(1)
        .map((sample, index) => sample.time - samples[index].time),
    ),
    toMs: (frames) => (frames / sampleRate) * 1000,
    windowOf: (index) =>
      between(samples, events[index][0], events.at(index + 1)?.[0] ?? end),
  };
};

const countStepsBack = (trace: Trace) => {
  const { samples, events, loop } = trace;
  const steps = { run: 0, largestRun: 0, drag: 0, loop: 0, turns: 0 };
  const declared = (from: number, to: number) =>
    events.some(
      (event) =>
        (event[1] === 'seek' || event[1] === 'playSeek') &&
        event[0] <= to &&
        event[0] >= from - declaredJumpMs,
    );
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const sample = samples[index];
    const back = previous.frame - sample.frame;
    const phase = events.findLast((event) => event[0] <= sample.time)?.[1];
    if (!phase || !previous.playing || !sample.playing || back <= 0) {
      continue;
    }
    if (phase === 'dragStart') {
      steps.drag += 1;
    } else if (phase === 'loopStart') {
      const turn = back > (loop.toFrame - loop.fromFrame) / 2;
      steps.turns += turn ? 1 : 0;
      steps.loop += turn ? 0 : 1;
    } else if (!declared(previous.time, sample.time)) {
      steps.run += 1;
      steps.largestRun = Math.max(steps.largestRun, trace.toMs(back));
    }
  }
  return steps;
};

const checkStalls = (trace: Trace) => {
  const stalls = { count: 0, longestMs: 0 };
  for (const [index, event] of trace.events.entries()) {
    if (event[1] !== 'play' && event[1] !== 'seek') {
      continue;
    }
    const after = between(
      trace.windowOf(index),
      event[0] + startupMs,
      Infinity,
    );
    const stall = longestStand(after);
    if (stall >= 3 * trace.screenFrameMs) {
      stalls.count += 1;
      stalls.longestMs = Math.max(stalls.longestMs, stall);
    }
  }
  return stalls;
};

const checkStops = (trace: Trace) => {
  const jumps: number[] = [];
  const distancesMs: number[] = [];
  const stops = { jumps, distancesMs, largestReversalMs: 0 };
  for (const [index, event] of trace.events.entries()) {
    if (event[1] !== 'stop') {
      continue;
    }
    const [, , frame] = event;
    const window = between(trace.windowOf(index), 0, event[0] + stopSettleMs);
    const settled = window.at(-1)?.frame ?? frame;
    stops.distancesMs.push(trace.toMs(settled - frame));
    let path = 0;
    let largestStep = 0;
    let last = frame;
    for (const sample of window) {
      path += Math.abs(sample.frame - last);
      largestStep = Math.max(largestStep, Math.abs(sample.frame - last));
      last = sample.frame;
    }
    stops.jumps.push(trace.toMs(largestStep) / trace.screenFrameMs);
    stops.largestReversalMs = Math.max(
      stops.largestReversalMs,
      trace.toMs(path - Math.abs(settled - frame)),
    );
  }
  return stops;
};

const checkSeeks = (trace: Trace) => {
  const settleMs: number[] = [];
  const seeks = { settleMs, unsettled: 0 };
  const reach = seekReachSeconds * trace.sampleRate;
  for (const [index, event] of trace.events.entries()) {
    if (event[1] !== 'seek') {
      continue;
    }
    const [time, , frame] = event;
    const reached = trace
      .windowOf(index)
      .find((sample) => Math.abs(sample.frame - frame) <= reach);
    if (reached) {
      seeks.settleMs.push(reached.time - time);
    } else {
      seeks.unsettled += 1;
    }
  }
  return seeks;
};

const checkPlaySeeks = (trace: Trace) => {
  const checked = { count: 0, standing: 0, longestStandMs: 0 };
  for (const [index, event] of trace.events.entries()) {
    if (event[1] !== 'playSeek') {
      continue;
    }
    checked.count += 1;
    const after = between(
      trace.windowOf(index),
      event[0] + declaredJumpMs,
      Infinity,
    );
    const stand = longestStand(after);
    checked.longestStandMs = Math.max(checked.longestStandMs, stand);
    checked.standing += stand >= standingMs ? 1 : 0;
  }
  return checked;
};

const checkReleases = (trace: Trace) =>
  trace.events
    .filter((event) => event[1] === 'dragEnd')
    .flatMap((event) => {
      const [time, , frame] = event;
      const before = trace.samples.findLast((sample) => sample.time <= time);
      return before ? [trace.toMs(frame - before.frame)] : [];
    });

const checkLoopEnd = (trace: Trace) => {
  let overshootMs = 0;
  for (const [index, event] of trace.events.entries()) {
    if (event[1] !== 'loopStart') {
      continue;
    }
    const end = trace.events
      .slice(index)
      .find((candidate) => candidate[1] === 'loopEnd');
    for (const sample of between(
      trace.samples,
      event[0],
      end?.[0] ?? Infinity,
    )) {
      overshootMs = Math.max(
        overshootMs,
        trace.toMs(sample.frame - trace.loop.toFrame),
      );
    }
  }
  return overshootMs;
};

export type CursorResult = {
  screenFrameMs: number;
  run: {
    stepsBack: number;
    largestStepBackMs: number;
    stalls: number;
    longestStallMs: number;
  };
  stop: {
    count: number;
    jumps: number[];
    distancesMs: number[];
    largestReversalMs: number;
  };
  seek: { count: number; settleMs: number[]; unsettled: number };
  playSeek: { count: number; standing: number; longestStandMs: number };
  drag: { count: number; stepsBack: number; behindMs: number[] };
  loop: { turns: number; stepsBack: number; overshootMs: number };
};

export const analyzeCursor = (run: CursorRun): CursorResult => {
  const trace = toTrace(run);
  const steps = countStepsBack(trace);
  const stalls = checkStalls(trace);
  const stops = checkStops(trace);
  const seeks = checkSeeks(trace);
  const releases = checkReleases(trace);
  return {
    screenFrameMs: trace.screenFrameMs,
    run: {
      stepsBack: steps.run,
      largestStepBackMs: steps.largestRun,
      stalls: stalls.count,
      longestStallMs: stalls.longestMs,
    },
    stop: { count: stops.jumps.length, ...stops },
    seek: { count: seeks.settleMs.length + seeks.unsettled, ...seeks },
    playSeek: checkPlaySeeks(trace),
    drag: { count: releases.length, stepsBack: steps.drag, behindMs: releases },
    loop: {
      turns: steps.turns,
      stepsBack: steps.loop,
      overshootMs: checkLoopEnd(trace),
    },
  };
};
