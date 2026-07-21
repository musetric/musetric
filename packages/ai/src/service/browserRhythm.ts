import {
  fetchFloat32,
  registerBrowserApi,
  reportProgress,
} from './browserShared.js';
import {
  analyzeRhythmApiName,
  type BrowserAnalyzeRhythmRequest,
  type BrowserAnalyzeRhythmResult,
} from './rhythmApi.js';

export const registerRhythmApi = (): void => {
  registerBrowserApi<BrowserAnalyzeRhythmRequest, BrowserAnalyzeRhythmResult>(
    analyzeRhythmApiName,
    async (request) => {
      await reportProgress(0);
      const audio = await fetchFloat32(request.pcmUrl, 'rhythm PCM');
      await reportProgress(0.1);

      const { createBeatThisGpuRuntime } =
        await import('../runtime/rhythm/beatThisGpuRuntime.js');
      const filterbank = await fetchFloat32(
        request.filterbankUrl,
        'rhythm mel filterbank',
      );
      const runtime = await createBeatThisGpuRuntime({
        modelUrl: request.modelUrl,
        filterbank,
      });
      try {
        const logits = await runtime.analyze(audio, async (progress) => {
          await reportProgress(0.1 + progress * 0.8);
        });
        await reportProgress(1);
        return {
          beat: Array.from(logits.beat),
          downbeat: Array.from(logits.downbeat),
        };
      } finally {
        await runtime.release();
      }
    },
  );
};
