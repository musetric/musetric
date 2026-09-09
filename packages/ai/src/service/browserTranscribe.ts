import {
  floatsFromBytes,
  jsonBytes,
  registerBrowserApi,
  reportLoading,
} from './browserShared.js';
import { serveUnits } from './browserUnitServing.js';
import {
  type BrowserTranscribeRequest,
  type BrowserTranscribeResult,
  transcribeAudioApiName,
} from './transcribeApi.js';

export const registerTranscribeApi = (): void => {
  registerBrowserApi<BrowserTranscribeRequest, void>(
    transcribeAudioApiName,
    async (request) => {
      await reportLoading();
      const [{ createWhisperRuntime }, { runTranscription }] =
        await Promise.all([
          import('../runtime/whisper/whisperRuntime.js'),
          import('../transcription/transcribePipeline.js'),
        ]);
      const runtime = await createWhisperRuntime({
        graph: request.graph,
        modelHost: request.modelHost,
        modelId: request.modelId,
        revision: request.revision,
        onLoading: () => {
          void reportLoading();
        },
      });
      try {
        await serveUnits({
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
};
