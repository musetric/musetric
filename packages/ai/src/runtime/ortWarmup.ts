import * as ort from 'onnxruntime-web/webgpu';
import { musetricWebGpuProvider } from './webgpuDevice.js';

const textEncoder = new TextEncoder();

const pushVarint = (target: number[], value: number): void => {
  let rest = value;
  while (rest >= 0x80) {
    target.push((rest % 0x80) | 0x80);
    rest = Math.floor(rest / 0x80);
  }
  target.push(rest);
};

type ProtoValue = number | string | Uint8Array;
type ProtoField = [number, ProtoValue];

const encodeProto = (fields: ProtoField[]): Uint8Array => {
  const bytes: number[] = [];
  for (const [field, value] of fields) {
    if (typeof value === 'number') {
      pushVarint(bytes, field * 8);
      pushVarint(bytes, value);
      continue;
    }
    const payload =
      typeof value === 'string' ? textEncoder.encode(value) : value;
    pushVarint(bytes, field * 8 + 2);
    pushVarint(bytes, payload.length);
    for (const byte of payload) {
      bytes.push(byte);
    }
  }
  return Uint8Array.from(bytes);
};

const warmupWidth = 256;
const warmupNodeCount = 300;
const warmupRunCount = 150;
const warmupOperators = ['Add', 'Abs', 'Neg', 'Relu'];
const warmupInput = 'x';
const warmupOutput = 'y';
const onnxIrVersion = 8;
const onnxOpsetVersion = 17;
const onnxFloat = 1;

const encodeValueInfo = (name: string): Uint8Array => {
  const shape = encodeProto(
    [1, warmupWidth].map((size) => [1, encodeProto([[1, size]])]),
  );
  const tensorType = encodeProto([
    [1, onnxFloat],
    [2, shape],
  ]);
  return encodeProto([
    [1, name],
    [2, encodeProto([[1, tensorType]])],
  ]);
};

const encodeWarmupNode = (index: number): Uint8Array => {
  const operator = warmupOperators[index % warmupOperators.length];
  const input = index === 0 ? warmupInput : `h${String(index - 1)}`;
  const output =
    index === warmupNodeCount - 1 ? warmupOutput : `h${String(index)}`;
  const inputs: ProtoField[] =
    operator === 'Add'
      ? [
          [1, input],
          [1, input],
        ]
      : [[1, input]];
  return encodeProto([...inputs, [2, output], [4, operator]]);
};

const createWarmupModel = (): Uint8Array => {
  const nodes = Array.from(
    { length: warmupNodeCount },
    (_, index): ProtoField => [1, encodeWarmupNode(index)],
  );
  const graph = encodeProto([
    ...nodes,
    [2, 'warmup'],
    [11, encodeValueInfo(warmupInput)],
    [12, encodeValueInfo(warmupOutput)],
  ]);
  return encodeProto([
    [1, onnxIrVersion],
    [7, graph],
    [8, encodeProto([[2, onnxOpsetVersion]])],
  ]);
};

export const warmUpOrt = async (settleMs: number): Promise<void> => {
  const session = await ort.InferenceSession.create(createWarmupModel(), {
    executionProviders: [
      await musetricWebGpuProvider({ storageBufferCacheMode: 'simple' }),
    ],
  });
  const input = new ort.Tensor(
    'float32',
    new Float32Array(warmupWidth).fill(0.5),
    [1, warmupWidth],
  );
  try {
    for (let run = 0; run < warmupRunCount; run += 1) {
      await session.run({ [warmupInput]: input });
    }
  } finally {
    await session.release();
  }
  await new Promise((resolve) => {
    setTimeout(resolve, settleMs);
  });
};
