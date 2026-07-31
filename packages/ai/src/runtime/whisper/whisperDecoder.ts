import { splitBySegments, type WordChunk } from './whisperSegments.js';

const sampleRate = 16000;

const encoderPositionSamples = 320;
const encoderPositions = 1500;

const timePrecision = 0.02;

const maxDecodeTokens = 400;
const tokensPerSecond = 12;
const minDecodeTokens = 32;

export type DecodeGuard = Record<string, number>;

type TokenId = number | bigint;

type GenerateOutput = {
  sequences: { tolist: () => TokenId[][] };
  token_timestamps: { tolist: () => number[][] };
};

export type WhisperModelInternals = {
  generation_config: {
    lang_to_id?: Record<string, number>;
    decoder_start_token_id?: number;
  };
  generate: (args: Record<string, unknown>) => Promise<GenerateOutput>;
} & ((args: Record<string, unknown>) => Promise<{
  logits: { data: Float32Array };
}>);

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
};

export const createWhisperDecoder = (
  internals: WhisperPipelineInternals,
): WhisperDecoder => {
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

  const decodeTimestamped = async (
    audio: Float32Array,
    language: string,
    guard: DecodeGuard | undefined,
  ): Promise<DecodeResult> => {
    const inputs = await internals.processor(audio);
    const output = await internals.model.generate({
      inputs: inputs.input_features,
      return_timestamps: true,
      return_token_timestamps: true,
      ...generateArgs(audio, language, guard),
    });

    const [rawTokens] = output.sequences.tolist();
    const [rawTimes] = output.token_timestamps.tolist();
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

  return { decodeTimestamped };
};
