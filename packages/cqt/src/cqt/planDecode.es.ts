import { type CqtConfig } from '../cqt/config.es.js';
import {
  type CqtOctavePlan,
  type CqtPlan,
  validateCqtPlan,
} from '../cqt/plan.es.js';

const magic = 0x5451434d;
const headerByteLength = 128;
const octaveByteLength = 32;
const sha256ByteLength = 32;

const readSha256 = (data: DataView): string => {
  let result = '';
  for (let index = 0; index < sha256ByteLength; index++) {
    result += data
      .getUint8(96 + index)
      .toString(16)
      .padStart(2, '0');
  }
  return result;
};

type ArtifactRange = {
  offset: number;
  byteLength: number;
  payloadStart: number;
  payloadEnd: number;
  label: string;
};

const checkRange = (range: ArtifactRange): void => {
  const {
    offset,
    byteLength: rawByteLength,
    payloadStart,
    payloadEnd,
    label,
  } = range;
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(rawByteLength) ||
    offset < payloadStart ||
    rawByteLength < 0 ||
    offset + rawByteLength > payloadEnd
  ) {
    throw new RangeError(`Invalid CQT plan ${label} range`);
  }
};

const requireAligned = (offset: number, label: string): void => {
  if (offset % 4 !== 0) {
    throw new RangeError(`CQT plan ${label} offset must be aligned to 4 bytes`);
  }
};

const getUint32Array = (
  bytes: Uint8Array,
  offset: number,
  length: number,
): Uint32Array => new Uint32Array(bytes.buffer, offset, length);

const getFloat32Array = (
  bytes: Uint8Array,
  offset: number,
  length: number,
): Float32Array => new Float32Array(bytes.buffer, offset, length);

const getOctaves = (
  data: DataView,
  offset: number,
  octaveCount: number,
): CqtOctavePlan[] => {
  const octaves: CqtOctavePlan[] = [];
  for (let index = 0; index < octaveCount; index++) {
    const base = offset + index * octaveByteLength;
    octaves.push({
      index: data.getUint32(base, true),
      sampleRate: data.getFloat64(base + 4, true),
      hopLength: data.getUint32(base + 12, true),
      fftSize: data.getUint32(base + 16, true),
      binStart: data.getUint32(base + 20, true),
      binCount: data.getUint32(base + 24, true),
    });
  }
  return octaves;
};

export const decodeCqtPlanArtifact = (artifact: Uint8Array): CqtPlan => {
  const bytes = artifact.slice();
  if (bytes.byteLength < headerByteLength) {
    throw new RangeError('CQT plan artifact is shorter than its header');
  }
  const data = new DataView(bytes.buffer);
  if (data.getUint32(0, true) !== magic) {
    throw new RangeError('CQT plan artifact has an invalid magic value');
  }
  const formatVersion = data.getUint32(4, true);
  if (data.getUint32(8, true) !== headerByteLength) {
    throw new RangeError('CQT plan artifact has an unsupported header size');
  }
  const payloadStart = headerByteLength;
  const payloadEnd = payloadStart + data.getUint32(60, true);
  if (payloadEnd !== bytes.byteLength) {
    throw new RangeError('CQT plan artifact has an invalid payload size');
  }

  const outputKind = data.getUint32(12, true);
  if (outputKind > 1) {
    throw new RangeError('CQT plan artifact has an unsupported output kind');
  }
  const config: CqtConfig = {
    sampleRate: data.getFloat64(16, true),
    hopLength: data.getUint32(24, true),
    nBins: data.getUint32(28, true),
    binsPerOctave: data.getUint32(32, true),
    fmin: data.getFloat64(40, true),
    output: outputKind === 0 ? 'magnitude' : 'logMagnitude',
  };
  const earlyDownsampleCount = data.getUint32(36, true);
  const octaveCount = data.getUint32(48, true);
  const tapCount = data.getUint32(52, true);
  const coefficientCount = data.getUint32(56, true);
  const generatorByteLength = data.getUint32(64, true);
  const generatorOffset = data.getUint32(68, true);
  const octavesOffset = data.getUint32(72, true);
  const rowOffsetsOffset = data.getUint32(76, true);
  const fftBinsOffset = data.getUint32(80, true);
  const coefficientsOffset = data.getUint32(84, true);
  const binLengthsOffset = data.getUint32(88, true);
  const downsampleOffset = data.getUint32(92, true);
  const rowCount = config.nBins + 1;
  const halfCoefficientCount = (tapCount + 1) / 2;

  checkRange({
    offset: generatorOffset,
    byteLength: generatorByteLength,
    payloadStart,
    payloadEnd,
    label: 'generator',
  });
  checkRange({
    offset: octavesOffset,
    byteLength: octaveCount * octaveByteLength,
    payloadStart,
    payloadEnd,
    label: 'octaves',
  });
  checkRange({
    offset: rowOffsetsOffset,
    byteLength: rowCount * Uint32Array.BYTES_PER_ELEMENT,
    payloadStart,
    payloadEnd,
    label: 'row offsets',
  });
  checkRange({
    offset: fftBinsOffset,
    byteLength: coefficientCount * Uint32Array.BYTES_PER_ELEMENT,
    payloadStart,
    payloadEnd,
    label: 'FFT bins',
  });
  checkRange({
    offset: coefficientsOffset,
    byteLength: coefficientCount * 2 * Float32Array.BYTES_PER_ELEMENT,
    payloadStart,
    payloadEnd,
    label: 'coefficients',
  });
  checkRange({
    offset: binLengthsOffset,
    byteLength: config.nBins * Float32Array.BYTES_PER_ELEMENT,
    payloadStart,
    payloadEnd,
    label: 'bin lengths',
  });
  checkRange({
    offset: downsampleOffset,
    byteLength: halfCoefficientCount * Float32Array.BYTES_PER_ELEMENT,
    payloadStart,
    payloadEnd,
    label: 'downsample coefficients',
  });
  for (const [offset, label] of [
    [octavesOffset, 'octaves'],
    [rowOffsetsOffset, 'row offsets'],
    [fftBinsOffset, 'FFT bins'],
    [coefficientsOffset, 'coefficients'],
    [binLengthsOffset, 'bin lengths'],
    [downsampleOffset, 'downsample coefficients'],
  ] as const) {
    requireAligned(offset, label);
  }

  let generator = '';
  for (let index = 0; index < generatorByteLength; index++) {
    const character = bytes[generatorOffset + index];
    if (character > 0x7f) {
      throw new RangeError('CQT plan generator must use ASCII text');
    }
    generator += String.fromCharCode(character);
  }
  const plan: CqtPlan = {
    formatVersion,
    generator,
    config,
    earlyDownsampleCount,
    octaves: getOctaves(data, octavesOffset, octaveCount),
    rowOffsets: getUint32Array(bytes, rowOffsetsOffset, rowCount),
    fftBins: getUint32Array(bytes, fftBinsOffset, coefficientCount),
    coefficients: getFloat32Array(
      bytes,
      coefficientsOffset,
      coefficientCount * 2,
    ),
    binLengths: getFloat32Array(bytes, binLengthsOffset, config.nBins),
    downsample: {
      tapCount,
      halfCoefficients: getFloat32Array(
        bytes,
        downsampleOffset,
        halfCoefficientCount,
      ),
      gain: Math.SQRT2,
      delay: (tapCount - 1) / 2,
      boundary: 'constant',
    },
    payloadSha256: readSha256(data),
  };
  validateCqtPlan(plan);
  return plan;
};

const toSha256Hex = (digest: ArrayBuffer): string =>
  Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, '0'),
  ).join('');

const isObject = (value: unknown): value is object =>
  typeof value === 'object' && Boolean(value);

export const getCqtPlanPayloadSha256 = async (
  artifact: Uint8Array,
): Promise<string> => {
  const bytes = artifact.slice();
  if (bytes.byteLength < headerByteLength) {
    throw new RangeError('CQT plan artifact is shorter than its header');
  }
  const data = new DataView(bytes.buffer);
  const payloadSize = data.getUint32(60, true);
  if (headerByteLength + payloadSize !== bytes.byteLength) {
    throw new RangeError('CQT plan artifact has an invalid payload size');
  }
  const cryptoLike: unknown = Reflect.get(globalThis, 'crypto');
  if (!isObject(cryptoLike)) {
    throw new Error('Web Crypto SHA-256 is not available');
  }
  const subtle: unknown = Reflect.get(cryptoLike, 'subtle');
  if (!isObject(subtle)) {
    throw new Error('Web Crypto SHA-256 is not available');
  }
  const digest: unknown = Reflect.get(subtle, 'digest');
  if (typeof digest !== 'function') {
    throw new Error('Web Crypto SHA-256 is not available');
  }
  const payload = bytes.slice(headerByteLength);
  const result: unknown = await Reflect.apply(digest, subtle, [
    'SHA-256',
    payload.buffer,
  ]);
  if (!(result instanceof ArrayBuffer)) {
    throw new Error('Web Crypto SHA-256 returned an invalid digest');
  }
  return toSha256Hex(result);
};

export const verifyCqtPlanArtifact = async (
  artifact: Uint8Array,
): Promise<CqtPlan> => {
  const plan = decodeCqtPlanArtifact(artifact);
  const actualSha256 = await getCqtPlanPayloadSha256(artifact);
  if (actualSha256 !== plan.payloadSha256) {
    throw new RangeError('CQT plan artifact payload SHA-256 does not match');
  }
  return plan;
};
