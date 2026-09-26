import {
  asBatchTensor,
  type BatchedGeneration,
  enableBatchedGeneration,
  endAtFirstEnd,
  holdFinished,
  stack,
} from './whisperBatch.js';
import {
  spanText,
  splitBySegments,
  type WordChunk,
} from './whisperSegments.js';
import { type StepSession } from './whisperStep.js';
import {
  type DecoderSession,
  encoderPositions,
  fetchStepOutputs,
} from './whisperStepOutputs.js';

const sampleRate = 16000;

const encoderPositionSamples = 320;

const timePrecision = 0.02;

const maxDecodeTokens = 400;
const tokensPerSecond = 12;
const minDecodeTokens = 32;

const endOfTextToken = 50257;

type TokenId = number | bigint;

type GenerateOutput = {
  sequences: { tolist: () => TokenId[][] };
  token_timestamps: { tolist: () => number[][] };
  past_key_values?: { dispose: () => Promise<void> };
};

type WhisperInputs = { input_features: unknown };

type EncoderFeeds = { input_features?: unknown };

type SessionRun = (feeds: EncoderFeeds, ...rest: never[]) => Promise<unknown>;

type ForwardTensor = { dispose: () => void };

export type WhisperModelInternals = {
  sessions: {
    model: { run: SessionRun };
    decoder_model_merged: DecoderSession & StepSession;
  };
  generation_config: {
    lang_to_id?: Record<string, number>;
    decoder_start_token_id?: number;
    eos_token_id?: number;
    alignment_heads?: number[][];
  };
  generate: (args: Record<string, unknown>) => Promise<GenerateOutput>;
} & BatchedGeneration &
  ((args: Record<string, unknown>) => Promise<
    Record<string, ForwardTensor> & {
      logits: ForwardTensor & { data: Float32Array };
    }
  >);

type AsrChunk = {
  tokens: TokenId[];
  token_timestamps: number[];
  stride: [number, number, number];
};

type AsrWords = { chunks?: WordChunk[] };

export type WhisperTokenizer = {
  decode: (ids: TokenId[], options?: Record<string, unknown>) => string;
  timestamp_begin: number;
  _decode_asr: (
    chunks: AsrChunk[],
    options: Record<string, unknown>,
  ) => [string, AsrWords];
};

export type WhisperPipelineInternals = {
  model: WhisperModelInternals;
  tokenizer: WhisperTokenizer;
  processor: (audio: Float32Array) => Promise<{ input_features: unknown }>;
};

export type DecodeGuard = Record<string, number>;

export type DecodeResult = {
  text?: string;
  chunks?: WordChunk[];
  segments?: WordChunk[][];
};

export type WhisperDecoder = {
  decodeTimestamped: (
    audio: Float32Array,
    language: string,
    guard: DecodeGuard | undefined,
  ) => Promise<DecodeResult>;

  decodeAligned: (
    audio: Float32Array,
    language: string,
  ) => Promise<DecodeResult>;

  decodeTimestampedBatch: (
    audios: Float32Array[],
    language: string,
    guard: DecodeGuard | undefined,
  ) => Promise<DecodeResult[]>;
};

export const createWhisperDecoder = (
  internals: WhisperPipelineInternals,
): WhisperDecoder => {
  const { model } = internals;
  fetchStepOutputs(model);
  const end = model.generation_config.eos_token_id ?? endOfTextToken;
  const batchRows = enableBatchedGeneration(model);

  const features = new WeakMap<Float32Array, unknown>();
  const encoded = new WeakMap<object, unknown>();
  const encoder = model.sessions.model;
  const runEncoder = encoder.run.bind(encoder);
  encoder.run = async (feeds: EncoderFeeds, ...rest: never[]) => {
    const input = feeds.input_features;
    if (typeof input !== 'object' || !input) {
      return runEncoder(feeds, ...rest);
    }
    const hit = encoded.get(input);
    if (hit) {
      return hit;
    }
    const output = await runEncoder(feeds, ...rest);
    encoded.set(input, output);
    return output;
  };

  const inputsFor = async (audio: Float32Array): Promise<WhisperInputs> => {
    const kept = features.get(audio);
    if (kept) {
      return { input_features: kept };
    }
    const inputs = await internals.processor(audio);
    features.set(audio, inputs.input_features);
    return inputs;
  };

  const generateArgs = (
    audio: Float32Array,
    language: string,
    guard: DecodeGuard | undefined,
  ): Record<string, unknown> => ({
    num_frames: Math.min(
      encoderPositions,
      Math.round(audio.length / encoderPositionSamples),
    ),
    language,
    task: 'transcribe',
    max_new_tokens: Math.min(
      maxDecodeTokens,
      Math.max(
        minDecodeTokens,
        Math.round((audio.length / sampleRate) * tokensPerSecond) +
          minDecodeTokens,
      ),
    ),

    ...guard,
  });

  const disposeCache = async (output: GenerateOutput): Promise<void> => {
    const cache = output.past_key_values;
    if (cache) {
      try {
        await cache.dispose();
      } catch (error) {
        console.warn(`whisper decode: cache dispose failed: ${String(error)}`);
      }
    }
  };

  const timestampedResult = (
    audio: Float32Array,
    rawTokens: TokenId[],
    rawTimes: number[],
  ): DecodeResult => {
    const { timestamp_begin: timestampBegin } = internals.tokenizer;
    const prefix = Math.max(
      rawTokens.findIndex((token) => Number(token) >= timestampBegin),
      0,
    );
    const tokens = rawTokens.slice(prefix);
    const chunk: AsrChunk = {
      tokens,
      token_timestamps: rawTimes
        .slice(prefix)
        .map((time) => Math.round(time * 100) / 100),
      stride: [audio.length / sampleRate, 0, 0],
    };
    const [text, words] = internals.tokenizer._decode_asr([chunk], {
      time_precision: timePrecision,
      return_timestamps: 'word',
      force_full_sequences: false,
    });

    const chunks = words.chunks ?? [];
    return {
      text,
      chunks,
      segments: splitBySegments({
        tokens: tokens.map(Number),
        words: chunks,
        timestampBegin,
        timePrecision,
      }),
    };
  };

  const decodeTimestamped = async (
    audio: Float32Array,
    language: string,
    guard: DecodeGuard | undefined,
  ): Promise<DecodeResult> => {
    const inputs = await inputsFor(audio);
    const output = await internals.model.generate({
      inputs: inputs.input_features,
      return_timestamps: true,
      return_token_timestamps: true,
      ...generateArgs(audio, language, guard),
    });
    await disposeCache(output);
    const [rawTokens] = output.sequences.tolist();
    const [rawTimes] = output.token_timestamps.tolist();
    return timestampedResult(audio, rawTokens, rawTimes);
  };

  const decodeTimestampedBatch = async (
    audios: Float32Array[],
    language: string,
    guard: DecodeGuard | undefined,
  ): Promise<DecodeResult[]> => {
    if (audios.length === 1) {
      return [await decodeTimestamped(audios[0], language, guard)];
    }
    const windows: WhisperInputs[] = [];
    for (const audio of audios) {
      windows.push(await inputsFor(audio));
    }
    const tensors = windows.map((inputs) =>
      asBatchTensor(inputs.input_features),
    );
    const args = audios.map((audio) => generateArgs(audio, language, guard));
    const frames = args.map((entry) => Number(entry.num_frames));
    batchRows.frames.push(...frames);
    batchRows.features.push(...windows.map((inputs) => inputs.input_features));
    try {
      const output = await internals.model.generate({
        inputs: stack(
          tensors.map((tensor) => tensor.data),
          tensors[0].dims,
        ),
        return_timestamps: true,
        return_token_timestamps: true,
        ...args[0],
        num_frames: Math.max(...frames),
        max_new_tokens: Math.max(
          ...args.map((entry) => Number(entry.max_new_tokens)),
        ),
        logits_processor: holdFinished(end),
      });
      await disposeCache(output);
      const rows = output.sequences.tolist();
      const times = output.token_timestamps.tolist();
      return audios.map((audio, index) => {
        const length = endAtFirstEnd(rows[index], end);
        return timestampedResult(
          audio,
          rows[index].slice(0, length),
          times[index].slice(0, length),
        );
      });
    } finally {
      batchRows.frames.length = 0;
      batchRows.features.length = 0;
    }
  };

  const decodeAligned = async (
    audio: Float32Array,
    language: string,
  ): Promise<DecodeResult> => {
    const inputs = await inputsFor(audio);
    const output = await internals.model.generate({
      inputs: inputs.input_features,
      return_token_timestamps: true,
      return_timestamps: false,
      ...generateArgs(audio, language, undefined),
    });
    await disposeCache(output);

    const [ids] = output.sequences.tolist();
    const [times] = output.token_timestamps.tolist();

    const chunks: WordChunk[] = [];
    for (const [index, id] of ids.entries()) {
      const piece = internals.tokenizer.decode([id], {
        skip_special_tokens: true,
      });
      if (!piece) {
        continue;
      }
      const startsWord = piece.startsWith(' ') || chunks.length === 0;
      const time = times[index] ?? 0;
      if (startsWord) {
        chunks.push({ text: piece, timestamp: [time, time] });
        continue;
      }
      const last = chunks[chunks.length - 1];
      last.text += piece;
      last.timestamp[1] = time;
    }
    for (const chunk of chunks) {
      if ((chunk.timestamp[1] ?? 0) <= chunk.timestamp[0]) {
        chunk.timestamp[1] = chunk.timestamp[0];
      }
    }

    return { text: spanText(chunks), chunks, segments: [chunks] };
  };

  return { decodeTimestamped, decodeAligned, decodeTimestampedBatch };
};
