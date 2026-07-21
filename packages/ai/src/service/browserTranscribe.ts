import {
  fetchFloat32,
  registerBrowserApi,
  reportProgress,
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
      const audio = await fetchFloat32(request.pcmUrl, 'transcription PCM');
      await reportProgress(0.02);

      const [{ createWhisperRuntime }, { runTranscription }] =
        await Promise.all([
          import('../runtime/whisper/whisperRuntime.js'),
          import('../transcription/transcribePipeline.js'),
        ]);
      const runtime = await createWhisperRuntime({
        modelHost: request.modelHost,
        modelId: request.modelId,
        revision: request.revision,

        onLoadProgress: (fraction) => {
          void reportProgress(0.02 + fraction * 0.38);
        },
      });

      try {
        await reportProgress(0.4);
        const result = await runTranscription({
          audio,
          language: request.language,
          detectLanguage: runtime.detectLanguage,
          transcribeBatch: runtime.transcribeBatch,

          onProgress: async (fraction) => reportProgress(0.4 + fraction * 0.6),
        });
        await reportProgress(1);
        return result;
      } finally {
        await runtime.release();
      }
    },
  );
};
