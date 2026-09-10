import { createBrowserJobApi } from './browserJob.js';
import { floatsFromBytes, jsonBytes } from './browserShared.js';
import {
  type BrowserTranscribeRequest,
  type BrowserTranscribeResult,
} from './transcribeApi.js';

export const transcribeAudio = createBrowserJobApi<BrowserTranscribeRequest>(
  async (request, context) => {
    context.reportLoading();
    const [{ createWhisperRuntime }, { runTranscription }] = await Promise.all([
      import('../runtime/whisper/whisperRuntime.js'),
      import('../transcription/transcribePipeline.js'),
    ]);
    const runtime = await createWhisperRuntime({
      graph: request.graph,
      modelHost: request.modelHost,
      modelId: request.modelId,
      revision: request.revision,
      onLoading: context.reportLoading,
    });
    try {
      await context.serveUnits({
        attemptId: request.attemptId,
        attemptUrl: request.attemptUrl,
        outputs: request.outputs,
        run: async (bytes) => {
          const audio = floatsFromBytes(bytes);
          const segments: BrowserTranscribeResult = await runTranscription({
            audio,
            language: request.language,
            detectLanguage: runtime.detectLanguage,
            transcribeBatch: runtime.transcribeBatch,
            transcribeAligned: runtime.transcribeAligned,
          });
          return jsonBytes(segments);
        },
      });
    } finally {
      await runtime.release();
    }
  },
);
