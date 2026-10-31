import * as ort from 'onnxruntime-web/webgpu';
import { musetricWebGpuProvider } from '../../runtime/webgpuDevice.js';
import { type WhisperDecodeTap } from '../../runtime/whisper/whisperDecoder.js';
import {
  createWhisperRuntime,
  whisperDeviceOptions,
} from '../../runtime/whisper/whisperRuntime.js';
import {
  fetchTensor,
  type ParityOutput,
  type ParityWhisperModelTask,
  type ParityWhisperTask,
} from './parityJob.js';

const endOfText = 50257;
const pastPrefix = 'past_key_values.';

const float32Output = (
  boundary: string,
  source: string,
  shape: number[],
  values: Float32Array,
): ParityOutput => ({ boundary, source, dtype: 'float32', shape, values });

type Downloadable = {
  dims: readonly number[];
  getData: () => Promise<unknown>;
};

const isDownloadable = (value: unknown): value is Downloadable =>
  typeof value === 'object' &&
  !!value &&
  'dims' in value &&
  'getData' in value &&
  typeof value.getData === 'function';

const download = async (tensor: Downloadable): Promise<Float32Array> => {
  const data = await tensor.getData();
  if (!(data instanceof Float32Array)) {
    throw new Error('whisper parity: a tensor is not float32');
  }
  return Float32Array.from(data);
};

const sessionOptions = async (
  provider: ParityWhisperModelTask['provider'],
  graphUrl: string,
): Promise<ort.InferenceSession.SessionOptions> => ({
  executionProviders:
    provider === 'wasm'
      ? ['wasm']
      : [await musetricWebGpuProvider(whisperDeviceOptions)],
  graphOptimizationLevel: 'all',
  externalData: [
    {
      path: `${graphUrl.slice(graphUrl.lastIndexOf('/') + 1)}_data`,
      data: `${graphUrl}_data`,
    },
  ],
});

const runEncoder = async (
  task: ParityWhisperModelTask,
): Promise<ParityOutput> => {
  const session = await ort.InferenceSession.create(
    task.encoderUrl,
    await sessionOptions(task.provider, task.encoderUrl),
  );
  try {
    const features = Float32Array.from(await fetchTensor(task.features));
    const outputs = await session.run({
      [session.inputNames[0]]: new ort.Tensor(
        'float32',
        features,
        task.features.shape,
      ),
    });
    const states = outputs[session.outputNames[0]];
    return float32Output(
      'encoder.output',
      task.provider,
      [...states.dims],
      await download(states),
    );
  } finally {
    await session.release();
  }
};

const emptyPast = (
  session: ort.InferenceSession,
): Record<string, ort.Tensor> => {
  const past: Record<string, ort.Tensor> = {};
  for (const metadata of session.inputMetadata) {
    if (metadata.isTensor && metadata.name.startsWith(pastPrefix)) {
      const [, heads, , width] = metadata.shape;
      past[metadata.name] = new ort.Tensor('float16', new Uint16Array(0), [
        1,
        Number(heads),
        0,
        Number(width),
      ]);
    }
  }
  return past;
};

const presentOf = (past: string): string =>
  past.replace(pastPrefix, 'present.');

const projectCross = async (
  task: ParityWhisperModelTask,
  states: ort.Tensor,
): Promise<Record<string, ort.Tensor>> => {
  const cross = await ort.InferenceSession.create(
    task.crossUrl,
    await sessionOptions(task.provider, task.crossUrl),
  );
  try {
    const outputs = await cross.run({ encoder_hidden_states: states });
    return Object.fromEntries(
      Object.entries(outputs).map((entry) => [
        entry[0].replace('present.', pastPrefix),
        entry[1],
      ]),
    );
  } finally {
    await cross.release();
  }
};

const keepDecoderPast = (
  past: Record<string, ort.Tensor>,
  outputs: ort.InferenceSession.ReturnType,
): void => {
  for (const name of Object.keys(past)) {
    if (name.includes('.decoder.')) {
      past[name] = outputs[presentOf(name)];
    }
  }
};

const runTeacherForced = async (
  task: ParityWhisperModelTask,
): Promise<ParityOutput> => {
  const session = await ort.InferenceSession.create(
    task.decoderUrl,
    await sessionOptions(task.provider, task.decoderUrl),
  );
  try {
    const tokens = Array.from(await fetchTensor(task.tokens), Number);
    const states = new ort.Tensor(
      'float32',
      Float32Array.from(await fetchTensor(task.encoderStates)),
      task.encoderStates.shape,
    );
    const empty = emptyPast(session);
    const fetches = ['logits', ...Object.keys(empty).map(presentOf)];
    const past = { ...empty, ...(await projectCross(task, states)) };
    const logits: Float32Array[] = [];
    for (const id of tokens.slice(0, -1)) {
      const outputs = await session.run(
        {
          ...past,
          input_ids: new ort.Tensor(
            'int64',
            BigInt64Array.of(BigInt(id)),
            [1, 1],
          ),
          encoder_hidden_states: states,
        },
        fetches,
      );
      logits.push(await download(outputs.logits));
      keepDecoderPast(past, outputs);
    }
    const values = new Float32Array(
      logits.reduce((total, part) => total + part.length, 0),
    );
    let offset = 0;
    for (const part of logits) {
      values.set(part, offset);
      offset += part.length;
    }
    const rows = tokens.length - 1;
    return float32Output(
      'decoder.logits',
      task.provider,
      [rows, values.length / rows],
      values,
    );
  } finally {
    await session.release();
  }
};

export const runWhisperModelTask = async (
  task: ParityWhisperModelTask,
): Promise<ParityOutput[]> => [
  await runEncoder(task),
  await runTeacherForced(task),
];

const timedTokens = (tap: WhisperDecodeTap): Float32Array => {
  const rows: number[] = [];
  for (const [index, token] of tap.tokens.entries()) {
    if (Number(token) < endOfText) {
      rows.push(Number(token), Math.round((tap.times[index] ?? 0) * 100) / 100);
    }
  }
  return Float32Array.from(rows);
};

const ortTensorOf = (value: unknown): unknown =>
  typeof value === 'object' && !!value && 'ort_tensor' in value
    ? value.ort_tensor
    : value;

const encoderStatesOf = (value: unknown): Downloadable => {
  const states =
    typeof value === 'object' && !!value && 'last_hidden_state' in value
      ? ortTensorOf(value.last_hidden_state)
      : undefined;
  if (!isDownloadable(states)) {
    throw new Error(
      'whisper parity: the encoder output has no last_hidden_state',
    );
  }
  return states;
};

type Features = {
  dims: number[];
  data: Float32Array;
};

const featuresOf = (value: unknown): Features => {
  if (
    typeof value === 'object' &&
    !!value &&
    'dims' in value &&
    'data' in value &&
    Array.isArray(value.dims) &&
    value.data instanceof Float32Array
  ) {
    return {
      dims: value.dims.map(Number),
      data: Float32Array.from(value.data),
    };
  }
  throw new Error('whisper parity: the features are not a float32 tensor');
};

type WhisperCapture = {
  features: Features;
  states: Float32Array;
  statesDims: number[];
  rows: Float32Array;
};

export const runWhisperTask = async (
  task: ParityWhisperTask,
): Promise<ParityOutput[]> => {
  const captures: WhisperCapture[] = [];
  const runtime = await createWhisperRuntime({
    graph: task.graph,
    modelHost: `${location.origin}${task.modelPath}`,
    modelId: task.modelId,
    revision: task.revision,
    report: { loading: () => undefined, building: () => undefined },
    inspect: async (tap) => {
      if (captures.length > 0) {
        return;
      }
      const states = encoderStatesOf(tap.encoderOutput);
      captures.push({
        features: featuresOf(tap.features),
        states: await download(states),
        statesDims: [...states.dims],
        rows: timedTokens(tap),
      });
    },
  });
  try {
    await runtime.transcribeBatch(
      [Float32Array.from(await fetchTensor(task.unitInput))],
      task.language,
    );
    const capture = captures.at(0);
    if (!capture) {
      throw new Error('whisper parity: the runtime decoded nothing');
    }
    const { features, rows } = capture;
    return [
      float32Output('model.input', 'product', features.dims, features.data),
      float32Output(
        'encoder.output',
        'product',
        capture.statesDims,
        capture.states,
      ),
      float32Output('result.tokens', 'product', [rows.length / 2, 2], rows),
    ];
  } finally {
    await runtime.release();
  }
};
