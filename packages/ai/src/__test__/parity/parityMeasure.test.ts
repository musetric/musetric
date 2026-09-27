import { describe, expect, it } from 'vitest';
import {
  measureTensors,
  type ParityTensor,
  type ParityValue,
  passes,
  phoneThreshold,
} from './parityMeasure.js';

const size = 4096;

const referenceValues = Float32Array.from({ length: size }, (_, index) =>
  Math.sin(index * 0.013),
);

const tensor = (values: Float32Array, shape = [2, size / 2]): ParityTensor => ({
  dtype: 'float32',
  shape,
  values,
});

const reference = tensor(referenceValues);

const withValue = (index: number, value: number): Float32Array => {
  const values = Float32Array.from(referenceValues);
  values[index] = value;
  return values;
};

const snrAgainstReference = (candidate: ParityTensor): ParityValue =>
  measureTensors({ measure: 'snr', reference, candidate });

const passesSnr = (value: ParityValue, atLeast: number): boolean =>
  value.kind === 'value' && passes(value.value, { atLeast });

describe('parity comparator negative controls', () => {
  it('accepts an identical output', () => {
    const value = snrAgainstReference(
      tensor(Float32Array.from(referenceValues)),
    );
    expect(value).toEqual({ kind: 'value', value: Infinity });
    expect(passesSnr(value, 40)).toBe(true);
  });

  it('rejects a NaN before any tolerance', () => {
    const value = snrAgainstReference(tensor(withValue(17, NaN)));
    expect(value).toEqual({
      kind: 'invalid',
      reason: 'value 17 is not finite',
    });
  });

  it('rejects an infinity before any tolerance', () => {
    const value = snrAgainstReference(tensor(withValue(9, Infinity)));
    expect(value).toEqual({ kind: 'invalid', reason: 'value 9 is not finite' });
  });

  it('rejects a wrong shape', () => {
    const value = snrAgainstReference(
      tensor(Float32Array.from(referenceValues), [size / 2, 2]),
    );
    expect(value.kind).toBe('invalid');
  });

  it('rejects a short output', () => {
    const value = snrAgainstReference(
      tensor(referenceValues.slice(0, size - 1), [2, size / 2]),
    );
    expect(value).toEqual({
      kind: 'invalid',
      reason: `${size - 1} values instead of ${size}`,
    });
  });

  it('fails a permuted output', () => {
    const value = snrAgainstReference(
      tensor(Float32Array.from(referenceValues).reverse()),
    );
    expect(passesSnr(value, 40)).toBe(false);
  });

  it('fails one changed element', () => {
    const snr = snrAgainstReference(tensor(withValue(1234, 10)));
    expect(passesSnr(snr, 40)).toBe(false);
    const worst = measureTensors({
      measure: 'maxAbs',
      reference,
      candidate: tensor(withValue(1234, 10)),
    });
    expect(
      worst.kind === 'value' && passes(worst.value, { atMost: 1e-3 }),
    ).toBe(false);
  });
});

describe('parity measures', () => {
  it('weights the error by the power of the input pair', () => {
    const silentPair = new Float32Array(size);
    silentPair.fill(1);
    silentPair[100] = 0;
    silentPair[101] = 0;
    const value = measureTensors({
      measure: 'weightedSnr',
      reference,
      candidate: tensor(withValue(100, 10)),
      weights: tensor(silentPair),
    });
    expect(value).toEqual({ kind: 'value', value: Infinity });
  });

  it('rejects weights of another length', () => {
    const value = measureTensors({
      measure: 'weightedSnr',
      reference,
      candidate: tensor(Float32Array.from(referenceValues)),
      weights: tensor(new Float32Array(size / 2), [size / 2]),
    });
    expect(value).toEqual({
      kind: 'invalid',
      reason: `weights hold ${size / 2} values instead of ${size}`,
    });
  });

  it('counts the elements beyond a tolerance', () => {
    const candidate = withValue(1234, referenceValues[1234] + 0.01);
    candidate[99] += 1e-5;
    const value = measureTensors({
      measure: 'differing',
      reference,
      candidate: tensor(candidate),
      tolerance: 1e-3,
    });
    expect(value).toEqual({ kind: 'value', value: 1 });
  });

  it('counts the rows whose largest logit moved', () => {
    const logits = (values: number[]): ParityTensor => ({
      dtype: 'float32',
      shape: [3, 4],
      values: Float32Array.from(values),
    });
    const value = measureTensors({
      measure: 'argmaxDiffering',
      reference: logits([0, 1, 0, 0, 5, 0, 0, 0, 0, 0, 0, 2]),
      candidate: logits([0, 1.5, 0, 0, 0, 0, 6, 0, 0, 0, 0, 2]),
    });
    expect(value).toEqual({ kind: 'value', value: 1 });
  });

  it('counts equal discrete values', () => {
    const value = measureTensors({
      measure: 'agreement',
      reference: {
        dtype: 'int32',
        shape: [4],
        values: Int32Array.of(1, 2, 3, 4),
      },
      candidate: {
        dtype: 'int32',
        shape: [4],
        values: Int32Array.of(1, 2, 0, 4),
      },
    });
    expect(value).toEqual({ kind: 'value', value: 0.75 });
  });

  it('holds a phone within its margin of the desktop', () => {
    const limit = phoneThreshold({ desktop: 42, marginDb: 3 });
    expect(passes(40, limit)).toBe(true);
    expect(passes(23.5, limit)).toBe(false);
  });
});

const events = (values: number[], shape = [values.length]): ParityTensor => ({
  dtype: 'float32',
  shape,
  values: Float32Array.from(values),
});

const beats = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4];

const beatFMeasure = (
  candidate: ParityTensor,
  expected = events(beats),
): ParityValue =>
  measureTensors({
    measure: 'fMeasure',
    reference: expected,
    candidate,
    tolerance: 0.07,
  });

describe('beat F-measure', () => {
  it('matches events within the tolerance in any order', () => {
    const shifted = beats.map((time) => time + 0.05).reverse();
    expect(beatFMeasure(events(shifted))).toEqual({ kind: 'value', value: 1 });
  });

  it('fails events outside the tolerance', () => {
    const late = beats.map((time) => time + 0.1);
    expect(beatFMeasure(events(late))).toEqual({ kind: 'value', value: 0 });
  });

  it('scores a missing and an extra event', () => {
    const value = beatFMeasure(events([...beats.slice(1), 4.25]));
    expect(value).toEqual({ kind: 'value', value: 14 / 16 });
  });

  it('treats two empty lists as equal and one as missing everything', () => {
    expect(beatFMeasure(events([]), events([]))).toEqual({
      kind: 'value',
      value: 1,
    });
    expect(beatFMeasure(events([]))).toEqual({ kind: 'value', value: 0 });
  });

  it('rejects a NaN and a list that is not one-dimensional', () => {
    expect(beatFMeasure(events([...beats.slice(1), NaN]))).toEqual({
      kind: 'invalid',
      reason: 'value 7 is not finite',
    });
    expect(beatFMeasure(events(beats, [2, 4])).kind).toBe('invalid');
  });
});
