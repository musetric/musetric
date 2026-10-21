const levelFloor = 1e-9;

export const getLevelEnvelope = (
  samples: ArrayLike<number>,
  sampleRate: number,
  blockSeconds: number,
): Float64Array => {
  const blockSize = Math.round(sampleRate * blockSeconds);
  const blockCount = Math.floor(samples.length / blockSize);
  const envelope = new Float64Array(blockCount);
  for (let block = 0; block < blockCount; block += 1) {
    let sum = 0;
    for (let index = 0; index < blockSize; index += 1) {
      const value = samples[block * blockSize + index];
      sum += value * value;
    }
    envelope[block] = 20 * Math.log10(Math.sqrt(sum / blockSize) + levelFloor);
  }
  return envelope;
};

const getCorrelation = (
  values: Float64Array,
  offset: number,
  reference: Float64Array,
) => {
  const count = reference.length;
  let sumA = 0;
  let sumB = 0;
  for (let index = 0; index < count; index += 1) {
    sumA += values[offset + index];
    sumB += reference[index];
  }
  const meanA = sumA / count;
  const meanB = sumB / count;
  let product = 0;
  let squareA = 0;
  let squareB = 0;
  for (let index = 0; index < count; index += 1) {
    const a = values[offset + index] - meanA;
    const b = reference[index] - meanB;
    product += a * b;
    squareA += a * a;
    squareB += b * b;
  }
  return product / Math.sqrt(squareA * squareB);
};

export type EnvelopeMatch = {
  offset: number;
  correlation: number;
};

export const findEnvelopeOffset = (
  envelope: Float64Array,
  reference: Float64Array,
): EnvelopeMatch => {
  let best: EnvelopeMatch = { offset: 0, correlation: -2 };
  for (
    let offset = 0;
    offset < envelope.length - reference.length;
    offset += 1
  ) {
    const correlation = getCorrelation(envelope, offset, reference);
    if (correlation > best.correlation) {
      best = { offset, correlation };
    }
  }
  return best;
};

export const clampEnvelope = (envelope: Float64Array, floor: number) =>
  envelope.map((value) => Math.max(value, floor));
