import {
  type AutomaticSpeechRecognitionPipeline,
  env,
  pipeline,
  Tensor,
} from '@huggingface/transformers';
import { whisperModel } from '../../models/whisperModel.js';
import { isHallucination } from '../../transcription/hallucinationFilter.js';
import { type TranscriptionWord } from '../../transcription/types.js';
import {
  createWhisperDecoder,
  type DecodeGuard,
  type DecodeResult,
  type WhisperPipelineInternals,
} from './whisperDecoder.js';
import {
  countWords,
  extractWords,
  isLooped,
  spanText,
} from './whisperSegments.js';

const sampleRate = 16000;

const guardLadder: DecodeGuard[] = [
  { no_repeat_ngram_size: 3 },
  { no_repeat_ngram_size: 3, repetition_penalty: 1.15 },
];

const collapsedWordsPerSecond = 0.25;
const collapsedMinSeconds = 12;
const alignedWordsPerSecond = 0.8;

type LoadProgress = {
  status?: string;
  progress?: number;
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

  transcribeAligned: (
    audio: Float32Array,
    language: string,
  ) => Promise<TranscriptionWord[]>;
  release: () => Promise<void>;
};

export const createWhisperRuntime = async (
  options: WhisperRuntimeOptions,
): Promise<WhisperRuntime> => {
  env.allowLocalModels = false;
  env.useBrowserCache = false;
  env.remoteHost = options.modelHost;
  env.remotePathTemplate = `{model}/resolve/${options.revision}/`;

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
        executionProviders: ['webgpu'],
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
  const { decodeTimestamped, decodeAligned } = createWhisperDecoder(internals);
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

  const decodePass = async (
    audios: Float32Array[],
    language: string,
    guard: DecodeGuard | undefined,
  ): Promise<DecodeResult[]> => {
    const results: DecodeResult[] = [];
    for (const audio of audios) {
      if (audio.length === 0) {
        console.log('whisper decode: empty chunk skipped');
        results.push({});
        continue;
      }
      results.push(await decodeTimestamped(audio, language, guard));
    }
    return results;
  };

  const transcribeBatch = async (
    audios: Float32Array[],
    language: string,
  ): Promise<TranscriptionWord[][]> => {
    if (audios.length === 0) {
      return [];
    }
    const decodeStart = performance.now();
    const maxDuration = Math.max(...audios.map((a) => a.length / sampleRate));

    const outputs = await decodePass(audios, language, undefined);

    const preferAligned = async (
      result: DecodeResult,
      audio: Float32Array,
    ): Promise<DecodeResult> => {
      const duration = audio.length / sampleRate;
      const words = countWords(result.text);
      const collapsed =
        duration >= collapsedMinSeconds &&
        words / duration < collapsedWordsPerSecond;
      if (!collapsed && !isHallucination(result.text ?? '')) {
        return result;
      }
      const aligned = await decodeAligned(audio, language);
      const alignedWords = countWords(aligned.text);
      const better =
        alignedWords > words &&
        alignedWords / duration >= alignedWordsPerSecond &&
        !isHallucination(aligned.text ?? '') &&
        !(await isLooped(aligned.text ?? ''));
      console.log(
        `whisper aligned decode: ${words}w -> ${alignedWords}w, ` +
          `${better ? 'taken' : 'kept timestamped'}`,
      );
      return better ? aligned : result;
    };

    const dropCaptionSegments = (result: DecodeResult): DecodeResult => {
      const segments = result.segments ?? [];
      if (segments.length === 0) {
        return isHallucination(result.text ?? '') ? { text: '' } : result;
      }
      const clean = segments.filter(
        (segment) => !isHallucination(spanText(segment)),
      );
      if (clean.length === segments.length) {
        return result;
      }
      for (const segment of segments) {
        if (!clean.includes(segment)) {
          console.log(`whisper caption dropped: ${spanText(segment)}`);
        }
      }
      const chunks = clean.flat();
      return { text: spanText(chunks), chunks, segments: clean };
    };

    const hasLoopedSegment = async (result: DecodeResult): Promise<boolean> => {
      const segments = result.segments ?? [];
      if (segments.length === 0) {
        return isLooped(result.text ?? '');
      }
      for (const segment of segments) {
        if (await isLooped(spanText(segment))) {
          return true;
        }
      }
      return false;
    };

    const runLadder = async (looped: number[]): Promise<void> => {
      let bad = looped;
      for (const guard of guardLadder) {
        if (bad.length === 0) {
          return;
        }
        const retried = await decodePass(
          bad.map((index) => audios[index]),
          language,
          guard,
        );
        const stillBad: number[] = [];
        for (const [retryIndex, index] of bad.entries()) {
          if (await hasLoopedSegment(retried[retryIndex])) {
            stillBad.push(index);
          } else {
            outputs[index] = retried[retryIndex];
          }
        }
        console.log(
          `whisper ladder ${JSON.stringify(guard)}: rescued ${bad.length - stillBad.length}/${bad.length} chunk(s)`,
        );
        bad = stillBad;
      }
    };

    const looped: number[] = [];
    for (const [index, result] of outputs.entries()) {
      if (await hasLoopedSegment(result)) {
        looped.push(index);
      }
    }
    await runLadder(looped);

    for (const [index, result] of outputs.entries()) {
      outputs[index] = dropCaptionSegments(
        await preferAligned(result, audios[index]),
      );
    }

    console.log(
      `whisper batch x${audios.length} (${maxDuration.toFixed(1)}s max) in ${((performance.now() - decodeStart) / 1000).toFixed(1)}s`,
    );
    return outputs.map((result) => extractWords(result.chunks ?? []));
  };

  const transcribeAligned = async (
    audio: Float32Array,
    language: string,
  ): Promise<TranscriptionWord[]> => {
    const aligned = await decodeAligned(audio, language);
    return extractWords(aligned.chunks ?? []);
  };

  const release = async (): Promise<void> => {
    await transcriber.dispose();
  };

  return { detectLanguage, transcribeBatch, transcribeAligned, release };
};
