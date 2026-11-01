import {
  createWhisperRuntime,
  type WhisperRuntime,
} from '../runtime/whisper/whisperRuntime.js';
import { buildLayout } from '../transcription/audioCompaction.js';
import { type Span } from '../transcription/spectralChunker.js';
import {
  decodeChunksPass,
  type DetectLanguage,
  finalizePass,
  planPass,
  repairPass,
  type Replacement,
  type TranscribeAligned,
  type TranscribeBatch,
  type TranscribePrompted,
} from '../transcription/transcribePipeline.js';
import { type TranscriptionWord } from '../transcription/types.js';
import { createBrowserJobApi } from './browserJob.js';
import { loadModel } from './browserModelLoad.js';
import { floatsFromBytes, jsonBytes } from './browserShared.js';
import { type BrowserTranscribeRequest } from './transcribeApi.js';

type UnitMeta =
  | { kind: 'plan' }
  | { kind: 'chunks'; language: string; lengths: number[] }
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
  detectLanguage: DetectLanguage;
  transcribeBatch: TranscribeBatch;
  transcribeAligned: TranscribeAligned;
  transcribePrompted: TranscribePrompted;
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
  if (meta.kind === 'chunks') {
    const runtime = await loadRuntime();
    const slices: Float32Array[] = [];
    let offset = 0;
    for (const length of meta.lengths) {
      slices.push(audio.subarray(offset, offset + length));
      offset += length;
    }
    return {
      words: await decodeChunksPass(
        slices,
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
        transcribePrompted: runtime.transcribePrompted,
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
    const holder: { runtime: Promise<WhisperRuntime> | undefined } = {
      runtime: undefined,
    };
    const loadRuntime = async (): Promise<WhisperRuntime> => {
      const cached = holder.runtime;
      if (cached !== undefined) {
        return cached;
      }
      const created = loadModel(context, async (report) =>
        createWhisperRuntime({
          graph: request.graph,
          modelHost: request.modelHost,
          modelId: request.modelId,
          revision: request.revision,
          report,
        }),
      );
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
