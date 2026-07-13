import {
  type AutomaticSpeechRecognitionPipeline,
  env,
  pipeline,
  Tensor,
} from '@huggingface/transformers';
import { whisperModel } from '../../models/whisperModel.js';
import { type TranscriptionWord } from '../../transcription/types.js';

type WordChunk = { text: string; timestamp: [number, number | null] };

const extractWords = (chunks: WordChunk[]): TranscriptionWord[] => {
  const words: TranscriptionWord[] = [];
  for (const chunk of chunks) {
    const text = chunk.text.trim();
    if (!text) {
      continue;
    }

    const [start, rawEnd] = chunk.timestamp;
    const end = rawEnd ?? start;
    words.push({ text, start, end });
  }
  return words;
};

const loopCompressionRatio = 2.4;

const fallbackTemperatures = [0, 0.2, 0.4, 0.6, 0.8, 1.0];

const compressionRatio = async (text: string): Promise<number> => {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length < 48) {
    return 0;
  }
  const compressedStream = new Blob([bytes])
    .stream()
    .pipeThrough(new CompressionStream('gzip'));
  const compressed = await new Response(compressedStream).arrayBuffer();
  return bytes.length / compressed.byteLength;
};

type LoadProgress = {
  status?: string;
  progress?: number;
};

type WhisperModelInternals = {
  generation_config: {
    lang_to_id?: Record<string, number>;
    decoder_start_token_id?: number;
  };
} & ((args: Record<string, unknown>) => Promise<{
  logits: { data: Float32Array };
}>);

type WhisperPipelineInternals = {
  model: WhisperModelInternals;
  processor: (audio: Float32Array) => Promise<{ input_features: unknown }>;
};

export type WhisperRuntimeOptions = {
  modelHost: string;
  modelId: string;
  revision: string;

  onLoadProgress?: (fraction: number) => void;
};

export type WhisperRuntime = {
  detectLanguage: (audio: Float32Array) => Promise<string>;

  transcribeBatch: (
    audios: Float32Array[],
    language: string,
  ) => Promise<TranscriptionWord[][]>;
  release: () => Promise<void>;
};

export const createWhisperRuntime = async (
  options: WhisperRuntimeOptions,
): Promise<WhisperRuntime> => {
  env.allowLocalModels = false;
  env.useBrowserCache = false;
  env.remoteHost = options.modelHost;
  env.remotePathTemplate = '{model}/resolve/{revision}/';

  const loadStart = performance.now();
  const transcriber: AutomaticSpeechRecognitionPipeline = await pipeline(
    'automatic-speech-recognition',
    options.modelId,
    {
      revision: options.revision,
      subfolder: '',
      device: 'webgpu',
      dtype: { ...whisperModel.dtype },

      session_options: {
        executionProviders: [
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          { name: 'webgpu', storageBufferCacheMode: 'bucket' } as {
            name: 'webgpu';
          },
        ],
      },
      progress_callback: (data: LoadProgress) => {
        if (data.status === 'progress' && typeof data.progress === 'number') {
          options.onLoadProgress?.(
            Math.max(0, Math.min(1, data.progress / 100)),
          );
        }
      },
    },
  );
  console.log(
    `whisper load: ${((performance.now() - loadStart) / 1000).toFixed(1)}s`,
  );

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const internals = transcriber as unknown as WhisperPipelineInternals;
  const generationConfig = internals.model.generation_config;
  const langToId = generationConfig.lang_to_id ?? {};
  const startToken = generationConfig.decoder_start_token_id ?? 50258;

  const detectLanguage = async (audio: Float32Array): Promise<string> => {
    const inputs = await internals.processor(audio);
    const output = await internals.model({
      input_features: inputs.input_features,
      decoder_input_ids: new Tensor(
        'int64',
        BigInt64Array.from([BigInt(startToken)]),
        [1, 1],
      ),
    });
    const { data } = output.logits;
    let best = '<|en|>';
    let bestValue = -Infinity;
    for (const [token, id] of Object.entries(langToId)) {
      if (data[id] > bestValue) {
        bestValue = data[id];
        best = token;
      }
    }

    return best.slice(2, -2);
  };

  type DecodeResult = { text?: string; chunks?: WordChunk[] };

  const decodePass = async (
    audios: Float32Array[],
    language: string,
    guard: boolean,
    temperature = 0,
  ): Promise<DecodeResult[]> => {
    const maxDuration = Math.max(...audios.map((a) => a.length / 16000));
    const maxNewTokens = Math.min(
      400,
      Math.max(32, Math.round(maxDuration * 12) + 32),
    );
    try {
      const output = await transcriber(audios, {
        return_timestamps: 'word',
        chunk_length_s: 0,
        language,
        task: 'transcribe',
        max_new_tokens: maxNewTokens,

        ...(temperature > 0 ? { do_sample: true, temperature } : {}),
        ...(guard ? { no_repeat_ngram_size: 3 } : {}),
      });
      return Array.isArray(output) ? output : [output];
    } catch (error) {
      if (!(error instanceof Error) || !/non-empty array/.test(error.message)) {
        throw error;
      }

      if (audios.length === 1) {
        console.log('whisper decode: empty chunk skipped');
        return [{}];
      }
      const results: DecodeResult[] = [];
      for (const audio of audios) {
        results.push(
          (await decodePass([audio], language, guard, temperature))[0],
        );
      }
      return results;
    }
  };

  const transcribeBatch = async (
    audios: Float32Array[],
    language: string,
  ): Promise<TranscriptionWord[][]> => {
    if (audios.length === 0) {
      return [];
    }
    const decodeStart = performance.now();
    const maxDuration = Math.max(...audios.map((a) => a.length / 16000));

    const outputs = await decodePass(audios, language, false);

    const isLooped = async (result: DecodeResult): Promise<boolean> =>
      (await compressionRatio(result.text ?? '')) > loopCompressionRatio;
    let looped: number[] = [];
    for (const [index, result] of outputs.entries()) {
      if (await isLooped(result)) {
        looped.push(index);
      }
    }
    for (const temperature of fallbackTemperatures) {
      if (looped.length === 0) {
        break;
      }
      const retried = await decodePass(
        looped.map((index) => audios[index]),
        language,
        true,
        temperature,
      );
      const stillLooped: number[] = [];
      for (const [retryIndex, index] of looped.entries()) {
        outputs[index] = retried[retryIndex];
        if (await isLooped(retried[retryIndex])) {
          stillLooped.push(index);
        }
      }
      const label = temperature > 0 ? `temp=${temperature}` : 'greedy+guard';
      console.log(
        `whisper ladder ${label}: rescued ${looped.length - stillLooped.length}/${looped.length} chunk(s)`,
      );
      looped = stillLooped;
    }

    console.log(
      `whisper batch x${audios.length} (${maxDuration.toFixed(1)}s max) in ${((performance.now() - decodeStart) / 1000).toFixed(1)}s`,
    );
    return outputs.map((result) => extractWords(result.chunks ?? []));
  };

  const release = async (): Promise<void> => {
    await transcriber.dispose();
  };

  return { detectLanguage, transcribeBatch, release };
};
