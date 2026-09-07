import {
  fetchFloat32,
  registerBrowserApi,
  reportLoading,
  reportRunning,
} from './browserShared.js';
import {
  type BrowserTranscribeRequest,
  type BrowserTranscribeResult,
  transcribeAudioApiName,
} from './transcribeApi.js';

export const registerTranscribeApi = (): void => {
  registerBrowserApi<BrowserTranscribeRequest, BrowserTranscribeResult>(
    transcribeAudioApiName,
    async (request) => {
      await reportLoading();
      const audio = await fetchFloat32(request.pcmUrl, 'transcription PCM');

      const [{ createWhisperRuntime }, { runTranscription }] =
        await Promise.all([
          import('../runtime/whisper/whisperRuntime.js'),
          import('../transcription/transcribePipeline.js'),
        ]);
      const runtime = await createWhisperRuntime({
        modelHost: request.modelHost,
        modelId: request.modelId,
        revision: request.revision,

        onLoading: () => {
          void reportLoading();
        },
      });

      try {
        return await runTranscription({
          audio,
          language: request.language,
          detectLanguage: runtime.detectLanguage,
          transcribeBatch: runtime.transcribeBatch,
          transcribeAligned: runtime.transcribeAligned,

          onDecoded: async (units) =>
            reportRunning({ pass: 'decode', ...units }),
          onRepaired: async (units) =>
            reportRunning({ pass: 'repair', ...units }),
        });
      } finally {
        await runtime.release();
      }
    },
  );
};
