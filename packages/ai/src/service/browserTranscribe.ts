import { type WhisperRuntime } from '../runtime/whisper/whisperRuntime.js';
import { buildLayout } from '../transcription/audioCompaction.js';
import { type Span } from '../transcription/spectralChunker.js';
import {
  decodeChunkPass,
  finalizePass,
  planPass,
  repairPass,
  type Replacement,
} from '../transcription/transcribePipeline.js';
import { type TranscriptionWord } from '../transcription/types.js';
import { createBrowserJobApi } from './browserJob.js';
import { floatsFromBytes, jsonBytes } from './browserShared.js';
import { type BrowserTranscribeRequest } from './transcribeApi.js';

type UnitMeta =
  | { kind: 'plan' }
  | { kind: 'chunk'; language: string }
  | {
      kind: 'repair';
      language: string;
      seamSeconds: number;
      packed: Span[][];
      words: TranscriptionWord[][];
    }
  | {
      kind: 'finalize';
      seamSeconds: number;
      packed: Span[][];
      words: TranscriptionWord[][];
      replaced: Replacement[];
    };

type UnitWindow = {
  meta: UnitMeta;
  audio: Float32Array<ArrayBuffer>;
};

export const parseUnitWindow = (bytes: Uint8Array): UnitWindow => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const metaLength = view.getUint32(0, true);
  const meta = JSON.parse(
    new TextDecoder().decode(bytes.subarray(4, 4 + metaLength)),
  );
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const typed = meta as UnitMeta;
  return {
    meta: typed,
    audio: floatsFromBytes(bytes.subarray(4 + metaLength)),
  };
};

export type UnitRuntime = {
  detectLanguage: (audio: Float32Array) => Promise<string>;
  transcribeBatch: (
    audios: Float32Array[],
    language: string,
  ) => Promise<TranscriptionWord[][]>;
  transcribeAligned: (
    audio: Float32Array,
    language: string,
  ) => Promise<TranscriptionWord[]>;
};

type UnitRequest = {
  language?: string;
  chunkSize: number;
  seamSeconds: number;
};

export const runTranscribeUnit = async (
  bytes: Uint8Array,
  request: UnitRequest,
  loadRuntime: () => Promise<UnitRuntime>,
): Promise<unknown> => {
  const { meta, audio } = parseUnitWindow(bytes);
  if (meta.kind === 'plan') {
    const runtime =
      request.language === undefined ? await loadRuntime() : undefined;
    return planPass(audio, {
      chunkSize: request.chunkSize,
      seamSeconds: request.seamSeconds,
      language: request.language,
      detectLanguage: runtime?.detectLanguage,
    });
  }
  if (meta.kind === 'chunk') {
    const runtime = await loadRuntime();
    return {
      words: await decodeChunkPass(
        audio,
        meta.language,
        runtime.transcribeBatch,
      ),
    };
  }
  if (meta.kind === 'repair') {
    const runtime = await loadRuntime();
    const { chunks, mapping } = buildLayout(meta.packed, meta.seamSeconds);
    return {
      replaced: await repairPass({
        compacted: audio,
        packed: meta.packed,
        chunks,
        mapping,
        words: meta.words,
        language: meta.language,
        transcribeAligned: runtime.transcribeAligned,
        transcribeBatch: runtime.transcribeBatch,
      }),
    };
  }
  return finalizePass({
    compacted: audio,
    packed: meta.packed,
    seamSeconds: meta.seamSeconds,
    words: meta.words,
    replaced: meta.replaced,
  });
};

export const transcribeAudio = createBrowserJobApi<BrowserTranscribeRequest>(
  async (request, context) => {
    context.reportLoading();
    const holder: { runtime: Promise<WhisperRuntime> | undefined } = {
      runtime: undefined,
    };
    const loadRuntime = async (): Promise<WhisperRuntime> => {
      const cached = holder.runtime;
      if (cached !== undefined) {
        return cached;
      }
      const module = await import('../runtime/whisper/whisperRuntime.js');
      const created = module.createWhisperRuntime({
        graph: request.graph,
        modelHost: request.modelHost,
        modelId: request.modelId,
        revision: request.revision,
        onLoading: context.reportLoading,
      });
      holder.runtime = created;
      return created;
    };
    try {
      await context.serveUnits({
        attemptId: request.attemptId,
        attemptUrl: request.attemptUrl,
        outputs: request.outputs,
        run: async (bytes) =>
          jsonBytes(await runTranscribeUnit(bytes, request, loadRuntime)),
      });
    } finally {
      const loaded = holder.runtime;
      if (loaded !== undefined) {
        await loaded.then(async (value) => value.release());
      }
    }
  },
);
