const beatsPerBarOptions = [3, 4];
const minBpm = 55;
const maxBpm = 215;
const transitionLambda = 100;
const observationLambda = 16;
const observationBorder = 1 / observationLambda;
const activationThreshold = 0.05;
const probabilityEpsilon = 1e-5;
const transitionFloor = 2 ** -52;

const roundHalfEven = (value: number): number => {
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (fraction !== 0.5) {
    return Math.round(value);
  }
  return floor % 2 === 0 ? floor : floor + 1;
};

const beatIntervals = (fps: number): number[] => {
  const shortest = roundHalfEven((60 * fps) / maxBpm);
  const longest = roundHalfEven((60 * fps) / minBpm);
  return Array.from(
    { length: longest - shortest + 1 },
    (_, index) => shortest + index,
  );
};

const sigmoid = (logit: number): number => 1 / (1 + Math.exp(-logit));

const clampProbability = (probability: number): number =>
  probability * (1 - probabilityEpsilon) + probabilityEpsilon / 2;

type Observations = {
  values: Float64Array;
  first: number;
  frames: number;
};

const createObservations = (
  beatLogits: Float32Array,
  downbeatLogits: Float32Array,
): Observations | undefined => {
  const combined = new Float64Array(beatLogits.length * 2);
  let first = -1;
  let last = -1;
  for (let frame = 0; frame < beatLogits.length; frame += 1) {
    const beat = clampProbability(sigmoid(beatLogits[frame]));
    const downbeat = clampProbability(sigmoid(downbeatLogits[frame]));
    const beatOnly = Math.max(beat - downbeat, probabilityEpsilon / 2);
    combined[frame * 2] = beatOnly;
    combined[frame * 2 + 1] = downbeat;
    if (beatOnly >= activationThreshold || downbeat >= activationThreshold) {
      first = first < 0 ? frame : first;
      last = frame;
    }
  }
  if (first < 0) {
    return undefined;
  }
  return {
    values: combined.subarray(first * 2, (last + 1) * 2),
    first,
    frames: last + 1 - first,
  };
};

const transitionProbabilities = (intervals: number[]): number[][] =>
  intervals.map((from) => {
    const row = intervals.map((to) => {
      const probability = Math.exp(-transitionLambda * Math.abs(to / from - 1));
      return probability <= transitionFloor ? 0 : probability;
    });
    const sum = row.reduce((total, value) => total + value, 0);
    return row.map((value) => value / sum);
  });

const observationPointer = (position: number): number => {
  if (position < observationBorder) {
    return 2;
  }
  return position % 1 < observationBorder ? 1 : 0;
};

type BarModel = {
  stateCount: number;
  firstStates: Int32Array;
  firstIndex: Int32Array;
  pointers: Uint8Array;
  beatNumbers: Uint8Array;
  candidateStarts: Int32Array;
  candidateStates: Int32Array;
  candidateLogProbabilities: Float64Array;
};

const createBarModel = (beatsPerBar: number, intervals: number[]): BarModel => {
  const beatStates = intervals.reduce((total, interval) => total + interval, 0);
  const stateCount = beatsPerBar * beatStates;
  const firstStates = new Int32Array(beatsPerBar * intervals.length);
  const lastStates = new Int32Array(beatsPerBar * intervals.length);
  const firstIndex = new Int32Array(stateCount).fill(-1);
  const pointers = new Uint8Array(stateCount);
  const beatNumbers = new Uint8Array(stateCount);
  let state = 0;
  for (let beat = 0; beat < beatsPerBar; beat += 1) {
    intervals.forEach((interval, intervalIndex) => {
      const slot = beat * intervals.length + intervalIndex;
      firstStates[slot] = state;
      lastStates[slot] = state + interval - 1;
      firstIndex[state] = slot;
      const step = 1 / interval;
      for (let phase = 0; phase < interval; phase += 1) {
        const position = phase * step + beat;
        pointers[state] = observationPointer(position);
        beatNumbers[state] = Math.trunc(position) + 1;
        state += 1;
      }
    });
  }
  const probabilities = transitionProbabilities(intervals);
  const starts: number[] = [];
  const states: number[] = [];
  const logProbabilities: number[] = [];
  for (let slot = 0; slot < firstStates.length; slot += 1) {
    const beat = Math.floor(slot / intervals.length);
    const to = slot % intervals.length;
    const previousBeat = (beat + beatsPerBar - 1) % beatsPerBar;
    starts.push(states.length);
    probabilities.forEach((row, from) => {
      if (row[to] !== 0) {
        states.push(lastStates[previousBeat * intervals.length + from]);
        logProbabilities.push(Math.log(row[to]));
      }
    });
  }
  starts.push(states.length);
  return {
    stateCount,
    firstStates,
    firstIndex,
    pointers,
    beatNumbers,
    candidateStarts: Int32Array.from(starts),
    candidateStates: Int32Array.from(states),
    candidateLogProbabilities: Float64Array.from(logProbabilities),
  };
};

const logDensities = (observations: Observations): Float64Array => {
  const { values, frames } = observations;
  const densities = new Float64Array(frames * 3);
  for (let frame = 0; frame < frames; frame += 1) {
    const beat = values[frame * 2];
    const downbeat = values[frame * 2 + 1];
    densities[frame * 3] = Math.log(
      (1 - (beat + downbeat)) / (observationLambda - 1),
    );
    densities[frame * 3 + 1] = Math.log(beat);
    densities[frame * 3 + 2] = Math.log(downbeat);
  }
  return densities;
};

type FrameStep = {
  model: BarModel;
  previous: Float64Array;
  current: Float64Array;
  densities: Float64Array;
  back: Uint16Array;
  frame: number;
};

const stepFrame = (step: FrameStep): void => {
  const { model, previous, current, densities, back, frame } = step;
  const { stateCount, firstStates, pointers } = model;
  const { candidateStarts, candidateStates, candidateLogProbabilities } = model;
  const slots = firstStates.length;
  const densityBase = frame * 3;
  for (let slot = 0; slot < slots; slot += 1) {
    const start = firstStates[slot];
    const end = slot + 1 < slots ? firstStates[slot + 1] : stateCount;
    const density = densities[densityBase + pointers[start]];
    let best = -Infinity;
    let from = 0;
    for (
      let candidate = candidateStarts[slot];
      candidate < candidateStarts[slot + 1];
      candidate += 1
    ) {
      const value =
        previous[candidateStates[candidate]] +
        candidateLogProbabilities[candidate] +
        density;
      if (value > best) {
        best = value;
        from = candidateStates[candidate];
      }
    }
    current[start] = best;
    back[frame * slots + slot] = from;
    for (let state = start + 1; state < end; state += 1) {
      current[state] =
        previous[state - 1] + densities[densityBase + pointers[state]];
    }
  }
};

type Decoded = {
  path: Int32Array;
  logProbability: number;
};

const decode = (
  model: BarModel,
  densities: Float64Array,
  frames: number,
): Decoded => {
  const { stateCount, firstStates, firstIndex } = model;
  const slots = firstStates.length;
  const back = new Uint16Array(frames * slots);
  let previous = new Float64Array(stateCount).fill(Math.log(1 / stateCount));
  let current = new Float64Array(stateCount);
  for (let frame = 0; frame < frames; frame += 1) {
    stepFrame({ model, previous, current, densities, back, frame });
    const swapped = previous;
    previous = current;
    current = swapped;
  }
  let state = 0;
  for (let candidate = 1; candidate < stateCount; candidate += 1) {
    state = previous[candidate] > previous[state] ? candidate : state;
  }
  const logProbability = previous[state];
  const path = new Int32Array(frames);
  for (let frame = frames - 1; frame >= 0; frame -= 1) {
    path[frame] = state;
    const slot = firstIndex[state];
    state = slot < 0 ? state - 1 : back[frame * slots + slot];
  }
  return { path, logProbability };
};

const strongestFrame = (
  values: Float64Array,
  left: number,
  right: number,
): number => {
  let best = left * 2;
  for (let index = left * 2 + 1; index < right * 2; index += 1) {
    best = values[index] > values[best] ? index : best;
  }
  return Math.floor(best / 2);
};

type BeatTimes = {
  beats: number[];
  downbeats: number[];
};

export const trackBeatTimes = (
  beatLogits: Float32Array,
  downbeatLogits: Float32Array,
  fps: number,
): BeatTimes => {
  const observations = createObservations(beatLogits, downbeatLogits);
  if (!observations) {
    return { beats: [], downbeats: [] };
  }
  const intervals = beatIntervals(fps);
  const densities = logDensities(observations);
  const decoded = beatsPerBarOptions.map((beatsPerBar) => {
    const model = createBarModel(beatsPerBar, intervals);
    return { model, ...decode(model, densities, observations.frames) };
  });
  const { model, path } = decoded.reduce(
    (best, item) => (item.logProbability > best.logProbability ? item : best),
    decoded[0],
  );
  const beats: number[] = [];
  const downbeats: number[] = [];
  let left = -1;
  for (let frame = 0; frame <= path.length; frame += 1) {
    const inRange = frame < path.length && model.pointers[path[frame]] >= 1;
    left = inRange && left < 0 ? frame : left;
    if (!inRange && left >= 0) {
      const peak = strongestFrame(observations.values, left, frame);
      const time = (peak + observations.first) / fps;
      beats.push(time);
      if (model.beatNumbers[path[peak]] === 1) {
        downbeats.push(time);
      }
      left = -1;
    }
  }
  return { beats, downbeats };
};
