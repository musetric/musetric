import {
  AutoConfig,
  AutomaticSpeechRecognitionPipeline,
  AutoProcessor,
  AutoTokenizer,
  env,
  type PretrainedConfig,
  Tensor,
  WhisperForConditionalGeneration,
} from '@huggingface/transformers';
import * as ort from 'onnxruntime-web/webgpu';
import {
  loadModelFilesInTurn,
  type ModelLoadReport,
} from '../../service/browserModelLoad.js';
import { fetchOk } from '../../service/browserShared.js';
import { isHallucination } from '../../transcription/hallucinationFilter.js';
import { type TranscriptionWord } from '../../transcription/types.js';
import { createGpuPacer } from '../gpuPacer.js';
import { type WhisperGraph } from '../modelGraphs.js';
import {
  getMusetricWebGpuDevice,
  musetricWebGpuProvider,
} from '../webgpuDevice.js';
import {
  createWhisperDecoder,
  type DecodeGuard,
  type DecodeResult,
  type WhisperDecodeInspect,
  type WhisperPipelineInternals,
} from './whisperDecoder.js';
import {
  countWords,
  extractWords,
  type HalvesRule,
  isLooped,
  joinHalves,
  needsHalves,
  spanText,
  type WordChunk,
} from './whisperSegments.js';
import {
  isFirstStep,
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
const halvesRule: HalvesRule = { minSeconds: 12, coverage: 0.6, maxGap: 6 };
const splitMinGain = 3;
export const whisperDeviceOptions = { subgroups: false };

const presentOnGpu = (
  config: PretrainedConfig,
): Record<string, ort.Tensor.DataLocation> => {
  if (
    !('decoder_layers' in config) ||
    typeof config.decoder_layers !== 'number'
  ) {
    throw new Error('the whisper config names no decoder layers');
  }
  const names = Array.from({ length: config.decoder_layers }, (_, layer) =>
    ['decoder', 'encoder'].flatMap((part) =>
      ['key', 'value'].map((kind) => `present.${layer}.${part}.${kind}`),
    ),
  ).flat();
  return Object.fromEntries(names.map((name) => [name, 'gpu-buffer']));
};

export type WhisperRuntimeOptions = {
  graph: WhisperGraph;
  modelHost: string;
  modelId: string;
  revision: string;

  report: ModelLoadReport;
  inspect?: WhisperDecodeInspect;
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
  const pretrained = { revision: options.revision };
  const fileUrl = (file: string): string =>
    `${options.modelHost}/${options.modelId}/resolve/${options.revision}/${file}`;

  const [config, tokenizer, processor, generation] = await Promise.all([
    AutoConfig.from_pretrained(options.modelId, pretrained),
    AutoTokenizer.from_pretrained(options.modelId, pretrained),
    AutoProcessor.from_pretrained(options.modelId, pretrained),
    fetchOk(
      fileUrl('generation_config.json'),
      'the whisper generation config',
    ).then(async (response): Promise<unknown> => response.json()),
  ]);
  const graphs = [
    { file: 'encoder_model_q4.onnx', outputs: {} },
    {
      file: 'decoder_model_merged_fp16.onnx',
      outputs: { preferredOutputLocation: presentOnGpu(config) },
    },
    {
      file: 'cross_kv_fp16.onnx',
      outputs: { preferredOutputLocation: 'gpu-buffer' as const },
    },
  ];
  const provider = await musetricWebGpuProvider(whisperDeviceOptions);
  const [encoderSession, decoderSession, cross] = await loadModelFilesInTurn(
    graphs.map((graph) => [fileUrl(graph.file), fileUrl(`${graph.file}_data`)]),
    options.report,
    async (files, index) => {
      const [graph, data] = files;
      return ort.InferenceSession.create(graph, {
        ...graphs[index].outputs,
        executionProviders: [provider],
        externalData: [{ path: `${graphs[index].file}_data`, data }],
      });
    },
  );

  const transcriber = new AutomaticSpeechRecognitionPipeline({
    task: 'automatic-speech-recognition',
    model: new WhisperForConditionalGeneration(
      config,
      { model: encoderSession, decoder_model_merged: decoderSession },
      { generation_config: generation },
    ),
    tokenizer,
    processor,
  });

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const internals = transcriber as unknown as WhisperPipelineInternals;

  const step: StepSession = internals.model.sessions.decoder_model_merged;
  const { device } = await getMusetricWebGpuDevice(whisperDeviceOptions);
  const pacer = createGpuPacer(device);
  const encoder = internals.model.sessions.model;
  const runEncoder = encoder.run.bind(encoder);
  encoder.run = async (...args) => pacer.pace(async () => runEncoder(...args));
  const { decodeAligned, decodeTimestampedBatch } = createWhisperDecoder(
    internals,
    options.inspect,
  );
  routeFirstStep(step, { cross, device });
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
    for (
      let from = 0;
      from < pending.length;
      from += options.graph.windowsPerBatch
    ) {
      const group = pending.slice(from, from + options.graph.windowsPerBatch);
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

    const splitInHalves = async (
      result: DecodeResult,
      audio: Float32Array,
    ): Promise<DecodeResult> => {
      const duration = audio.length / sampleRate;
      if (!needsHalves(result.chunks ?? [], duration, halvesRule)) {
        return result;
      }
      const middle = Math.round(audio.length / 2);
      const halves = await decodePass(
        [audio.subarray(0, middle), audio.subarray(middle)],
        language,
        undefined,
      );
      const kept: WordChunk[][] = [];
      for (const half of halves) {
        const clean = dropCaptionSegments(half);
        kept.push((await hasLoopedSegment(clean)) ? [] : (clean.chunks ?? []));
      }
      const joined = joinHalves(kept[0], kept[1], middle / sampleRate);
      return countWords(spanText(joined)) >=
        countWords(result.text) + splitMinGain
        ? { text: spanText(joined), chunks: joined, segments: [joined] }
        : result;
    };

    for (const [index, result] of outputs.entries()) {
      outputs[index] = await splitInHalves(result, audios[index]);
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
    await cross.release();
    await transcriber.dispose();
  };

  return { detectLanguage, transcribeBatch, transcribeAligned, release };
};
