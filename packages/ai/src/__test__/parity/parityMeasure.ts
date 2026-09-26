const elementCount = (shape: number[]): number =>
  shape.reduce((product, size) => product * size, 1);

const firstNonFinite = (values: Float32Array | Int32Array): number =>
  values.findIndex((value) => !Number.isFinite(value));

export type ParityDtype = 'float32' | 'int32';

export type ParityTensor = {
  dtype: ParityDtype;
  shape: number[];
  values: Float32Array | Int32Array;
};

const checkValues = (
  reference: ParityTensor,
  candidate: ParityTensor,
): string | undefined => {
  const expected = elementCount(reference.shape);
  if (reference.values.length !== expected) {
    return `reference holds ${reference.values.length} values instead of ${expected}`;
  }
  const found = elementCount(candidate.shape);
  if (candidate.values.length !== found) {
    return `${candidate.values.length} values instead of ${found}`;
  }
  const referenceBad = firstNonFinite(reference.values);
  if (referenceBad >= 0) {
    return `reference value ${referenceBad} is not finite`;
  }
  const candidateBad = firstNonFinite(candidate.values);
  if (candidateBad >= 0) {
    return `value ${candidateBad} is not finite`;
  }
  return undefined;
};

export const checkTensors = (
  reference: ParityTensor,
  candidate: ParityTensor,
): string | undefined => {
  if (candidate.dtype !== reference.dtype) {
    return `dtype ${candidate.dtype} instead of ${reference.dtype}`;
  }
  if (candidate.shape.join('x') !== reference.shape.join('x')) {
    return `shape ${candidate.shape.join('x')} instead of ${reference.shape.join('x')}`;
  }
  return checkValues(reference, candidate);
};

export const checkEvents = (
  reference: ParityTensor,
  candidate: ParityTensor,
): string | undefined => {
  if (candidate.dtype !== reference.dtype) {
    return `dtype ${candidate.dtype} instead of ${reference.dtype}`;
  }
  if (reference.shape.length !== 1 || candidate.shape.length !== 1) {
    return `shapes ${reference.shape.join('x')} and ${candidate.shape.join('x')} are not event lists`;
  }
  return checkValues(reference, candidate);
};

export const snrDb = (
  reference: Float32Array | Int32Array,
  candidate: Float32Array | Int32Array,
  weights?: Float64Array,
): number => {
  let signal = 0;
  let noise = 0;
  for (let index = 0; index < reference.length; index += 1) {
    const weight = weights ? weights[index] : 1;
    const difference = reference[index] - candidate[index];
    signal += reference[index] * reference[index] * weight;
    noise += difference * difference * weight;
  }
  return noise === 0 ? Infinity : 10 * Math.log10(signal / noise);
};

export const maxAbsError = (
  reference: Float32Array | Int32Array,
  candidate: Float32Array | Int32Array,
): number => {
  let worst = 0;
  for (let index = 0; index < reference.length; index += 1) {
    worst = Math.max(worst, Math.abs(reference[index] - candidate[index]));
  }
  return worst;
};

export const differingCount = (
  reference: Float32Array | Int32Array,
  candidate: Float32Array | Int32Array,
  tolerance: number,
): number => {
  let differing = 0;
  for (let index = 0; index < reference.length; index += 1) {
    if (Math.abs(reference[index] - candidate[index]) > tolerance) {
      differing += 1;
    }
  }
  return differing;
};

const argmaxAt = (
  values: Float32Array | Int32Array,
  offset: number,
  width: number,
): number => {
  let best = 0;
  for (let index = 1; index < width; index += 1) {
    if (values[offset + index] > values[offset + best]) {
      best = index;
    }
  }
  return best;
};

export const argmaxDifferingCount = (
  reference: Float32Array | Int32Array,
  candidate: Float32Array | Int32Array,
  width: number,
): number => {
  let differing = 0;
  for (let offset = 0; offset < reference.length; offset += width) {
    if (
      argmaxAt(reference, offset, width) !== argmaxAt(candidate, offset, width)
    ) {
      differing += 1;
    }
  }
  return differing;
};

export const agreement = (
  reference: Float32Array | Int32Array,
  candidate: Float32Array | Int32Array,
): number => {
  let equal = 0;
  for (let index = 0; index < reference.length; index += 1) {
    equal += reference[index] === candidate[index] ? 1 : 0;
  }
  return reference.length === 0 ? 1 : equal / reference.length;
};

export const eventFMeasure = (
  reference: Float32Array | Int32Array,
  candidate: Float32Array | Int32Array,
  tolerance: number,
): number => {
  if (reference.length === 0 && candidate.length === 0) {
    return 1;
  }
  const expected = Float64Array.from(reference).sort();
  const found = Float64Array.from(candidate).sort();
  let matched = 0;
  let left = 0;
  let right = 0;
  while (left < expected.length && right < found.length) {
    const difference = found[right] - expected[left];
    if (Math.abs(difference) <= tolerance) {
      matched += 1;
      left += 1;
      right += 1;
    } else if (difference < 0) {
      right += 1;
    } else {
      left += 1;
    }
  }
  return (2 * matched) / (expected.length + found.length);
};

export const pairPower = (spectrum: Float32Array): Float64Array => {
  const weights = new Float64Array(spectrum.length);
  for (let index = 0; index < spectrum.length; index += 2) {
    const power =
      spectrum[index] * spectrum[index] +
      spectrum[index + 1] * spectrum[index + 1];
    weights[index] = power;
    weights[index + 1] = power;
  }
  return weights;
};

export type ParityMeasure =
  | 'snr'
  | 'weightedSnr'
  | 'maxAbs'
  | 'differing'
  | 'argmaxDiffering'
  | 'agreement'
  | 'fMeasure';

export type ParityMeasureInput = {
  measure: ParityMeasure;
  reference: ParityTensor;
  candidate: ParityTensor;
  weights?: ParityTensor;
  tolerance?: number;
};

const measures: Record<ParityMeasure, (input: ParityMeasureInput) => number> = {
  snr: (input) => snrDb(input.reference.values, input.candidate.values),
  weightedSnr: (input) =>
    snrDb(
      input.reference.values,
      input.candidate.values,
      input.weights && pairPower(Float32Array.from(input.weights.values)),
    ),
  maxAbs: (input) =>
    maxAbsError(input.reference.values, input.candidate.values),
  differing: (input) =>
    differingCount(
      input.reference.values,
      input.candidate.values,
      input.tolerance ?? 0,
    ),
  argmaxDiffering: (input) =>
    argmaxDifferingCount(
      input.reference.values,
      input.candidate.values,
      input.reference.shape.at(-1) ?? 1,
    ),
  agreement: (input) =>
    agreement(input.reference.values, input.candidate.values),
  fMeasure: (input) =>
    eventFMeasure(
      input.reference.values,
      input.candidate.values,
      input.tolerance ?? 0,
    ),
};

export type ParityValue =
  | { kind: 'invalid'; reason: string }
  | { kind: 'value'; value: number };

export const measureTensors = (input: ParityMeasureInput): ParityValue => {
  const reason =
    input.measure === 'fMeasure'
      ? checkEvents(input.reference, input.candidate)
      : checkTensors(input.reference, input.candidate);
  if (reason !== undefined) {
    return { kind: 'invalid', reason };
  }
  if (
    input.weights &&
    input.weights.values.length !== input.reference.values.length
  ) {
    return {
      kind: 'invalid',
      reason: `weights hold ${input.weights.values.length} values instead of ${input.reference.values.length}`,
    };
  }
  return { kind: 'value', value: measures[input.measure](input) };
};

export type ParityThreshold = {
  atLeast?: number;
  atMost?: number;
};

export const passes = (value: number, threshold: ParityThreshold): boolean =>
  (threshold.atLeast === undefined || value >= threshold.atLeast) &&
  (threshold.atMost === undefined || value <= threshold.atMost);

export type PhoneThreshold = {
  desktop: number;
  marginDb: number;
};

export const phoneThreshold = (limit: PhoneThreshold): ParityThreshold => ({
  atLeast: limit.desktop - limit.marginDb,
});
