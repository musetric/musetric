import * as ort from 'onnxruntime-web/webgpu';
import { musetricWebGpuProvider } from '../../runtime/webgpuDevice.js';
import { type WhisperDecodeTap } from '../../runtime/whisper/whisperDecoder.js';
import {
  createWhisperRuntime,
  readWhisperSubgroups,
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
): Promise<ort.InferenceSession.SessionOptions> => ({
  executionProviders:
    provider === 'wasm'
      ? ['wasm']
      : [
          await musetricWebGpuProvider({
            subgroups: await readWhisperSubgroups(),
          }),
        ],
  graphOptimizationLevel: 'all',
});

const runEncoder = async (
  task: ParityWhisperModelTask,
): Promise<ParityOutput> => {
  const session = await ort.InferenceSession.create(
    task.encoderUrl,
    await sessionOptions(task.provider),
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

type DecoderStep = {
  ids: number[];
  useCache: boolean;
};

const runTeacherForced = async (
  task: ParityWhisperModelTask,
): Promise<ParityOutput> => {
  const session = await ort.InferenceSession.create(
    task.decoderUrl,
    await sessionOptions(task.provider),
  );
  try {
    const tokens = Array.from(await fetchTensor(task.tokens), Number);
    const states = new ort.Tensor(
      'float32',
      Float32Array.from(await fetchTensor(task.encoderStates)),
      task.encoderStates.shape,
    );
    let past = emptyPast(session);
    const pastNames = Object.keys(past);
    const fetches = ['logits', ...pastNames.map(presentOf)];
    const logits: Float32Array[] = [];
    const step = async (
      decoderStep: DecoderStep,
    ): Promise<ort.InferenceSession.ReturnType> => {
      const outputs = await session.run(
        {
          ...past,
          input_ids: new ort.Tensor(
            'int64',
            BigInt64Array.from(decoderStep.ids, BigInt),
            [1, decoderStep.ids.length],
          ),
          encoder_hidden_states: states,
          use_cache_branch: new ort.Tensor(
            'bool',
            Uint8Array.of(decoderStep.useCache ? 1 : 0),
            [1],
          ),
        },
        fetches,
      );
      logits.push(await download(outputs.logits));
      return outputs;
    };
    const first = await step({
      ids: tokens.slice(0, task.promptLength),
      useCache: false,
    });
    past = Object.fromEntries(
      pastNames.map((name) => [name, first[presentOf(name)]]),
    );
    for (
      let position = task.promptLength;
      position < tokens.length - 1;
      position += 1
    ) {
      const outputs = await step({ ids: [tokens[position]], useCache: true });
      for (const name of pastNames.filter((entry) =>
        entry.includes('.decoder.'),
      )) {
        past[name] = outputs[presentOf(name)];
      }
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

const timedTokens = (
  tap: WhisperDecodeTap,
  timestampBegin: number,
): Float32Array => {
  const tokens = tap.tokens.map(Number);
  const found = tokens.findIndex((token) => token >= timestampBegin);
  const start = found === -1 ? tokens.length : found;
  const end =
    tokens.length > start && tokens.at(-1) === endOfText
      ? tokens.length - 1
      : tokens.length;
  const rows: number[] = [];
  for (let index = start; index < end; index += 1) {
    rows.push(tokens[index], Math.round((tap.times[index] ?? 0) * 100) / 100);
  }
  return Float32Array.from(rows);
};

const encoderStatesOf = (value: unknown): Downloadable => {
  if (
    typeof value === 'object' &&
    !!value &&
    'last_hidden_state' in value &&
    isDownloadable(value.last_hidden_state)
  ) {
    return value.last_hidden_state;
  }
  throw new Error(
    'whisper parity: the encoder output has no last_hidden_state',
  );
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

export const runWhisperTask = async (
  task: ParityWhisperTask,
): Promise<ParityOutput[]> => {
  const taps: WhisperDecodeTap[] = [];
  const runtime = await createWhisperRuntime({
    graph: task.graph,
    modelHost: `${location.origin}${task.modelPath}`,
    modelId: task.modelId,
    revision: task.revision,
    onLoading: () => undefined,
    inspect: async (tap) => {
      taps.push(tap);
      await Promise.resolve();
    },
  });
  try {
    await runtime.transcribeBatch(
      [Float32Array.from(await fetchTensor(task.unitInput))],
      task.language,
    );
    const tap = taps.at(0);
    if (!tap) {
      throw new Error('whisper parity: the runtime decoded nothing');
    }
    const features = featuresOf(tap.features);
    const states = encoderStatesOf(tap.encoderOutput);
    const rows = timedTokens(tap, task.timestampBegin);
    return [
      float32Output('model.input', 'product', features.dims, features.data),
      float32Output(
        'encoder.output',
        'product',
        [...states.dims],
        await download(states),
      ),
      float32Output('result.tokens', 'product', [rows.length / 2, 2], rows),
    ];
  } finally {
    await runtime.release();
  }
};
