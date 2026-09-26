import {
  type AutomaticSpeechRecognitionPipeline,
  env,
  pipeline,
  Tensor,
} from '@huggingface/transformers';
import * as ort from 'onnxruntime-web/webgpu';
import { fetchOk } from '../../service/browserShared.js';
import { isHallucination } from '../../transcription/hallucinationFilter.js';
import { type TranscriptionWord } from '../../transcription/types.js';
import { createGpuPacer } from '../gpuPacer.js';
import { type WhisperGraph } from '../modelGraphs.js';
import {
  getMusetricWebGpuDevice,
  musetricWebGpuProvider,
  readAdapterArchitecture,
} from '../webgpuDevice.js';
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
import {
  isFirstStep,
  isFlatStep,
  routeFirstStep,
  type StepSession,
} from './whisperStep.js';

const sampleRate = 16000;

const guardLadder: DecodeGuard[] = [
  { no_repeat_ngram_size: 3 },
  { no_repeat_ngram_size: 3, repetition_penalty: 1.15 },
];

const collapsedWordsPerSecond = 0.25;
const collapsedMinSeconds = 12;
const alignedWordsPerSecond = 0.8;
const windowsPerBatch = 4;
const subgroupArchitectures = new Set(['adreno-6xx']);

export type WhisperRuntimeOptions = {
  graph: WhisperGraph;
  modelHost: string;
  modelId: string;
  revision: string;

  onLoading: () => void;
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

  const subgroups = subgroupArchitectures.has(await readAdapterArchitecture());
  const transcriber: AutomaticSpeechRecognitionPipeline = await pipeline(
    'automatic-speech-recognition',
    options.modelId,
    {
      revision: options.revision,
      subfolder: '',
      device: 'webgpu',
      dtype: { ...options.graph.dtype },

      session_options: {
        executionProviders: [await musetricWebGpuProvider({ subgroups })],
      },
      progress_callback: () => {
        options.onLoading();
      },
    },
  );

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const internals = transcriber as unknown as WhisperPipelineInternals;

  const step: StepSession = internals.model.sessions.decoder_model_merged;
  const cross = isFlatStep(step)
    ? await ort.InferenceSession.create(
        new Uint8Array(
          await (
            await fetchOk(
              `${options.modelHost}/${options.modelId}/resolve/${options.revision}/cross_kv_${options.graph.dtype.decoder_model_merged}.onnx`,
              'the whisper cross projection',
            )
          ).arrayBuffer(),
        ),
        {
          executionProviders: [await musetricWebGpuProvider({ subgroups })],
          preferredOutputLocation: 'gpu-buffer',
        },
      )
    : undefined;

  const { device } = await getMusetricWebGpuDevice({ subgroups });
  const pacer = createGpuPacer(device);
  const encoder = internals.model.sessions.model;
  const runEncoder = encoder.run.bind(encoder);
  encoder.run = async (...args) => pacer.pace(async () => runEncoder(...args));
  const { decodeAligned, decodeTimestampedBatch } =
    createWhisperDecoder(internals);
  if (cross) {
    routeFirstStep(step, cross);
  }
  const runStep = step.run.bind(step);
  step.run = async (feeds, ...rest) =>
    isFirstStep(feeds)
      ? pacer.pace(async () => runStep(feeds, ...rest))
      : runStep(feeds, ...rest);
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
    for (const tensor of Object.values(output)) {
      tensor.dispose();
    }

    return best.slice(2, -2);
  };

  const decodePass = async (
    audios: Float32Array[],
    language: string,
    guard: DecodeGuard | undefined,
  ): Promise<DecodeResult[]> => {
    const results: DecodeResult[] = audios.map(() => ({}));
    const pending = audios.flatMap((audio, index) =>
      audio.length === 0 ? [] : [index],
    );
    for (let from = 0; from < pending.length; from += windowsPerBatch) {
      const group = pending.slice(from, from + windowsPerBatch);
      const decoded = await decodeTimestampedBatch(
        group.map((index) => audios[index]),
        language,
        guard,
      );
      for (const [position, index] of group.entries()) {
        results[index] = decoded[position];
      }
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
    await pacer.release();
    await cross?.release();
    await transcriber.dispose();
  };

  return { detectLanguage, transcribeBatch, transcribeAligned, release };
};
