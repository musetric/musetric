import { createWhisperRuntime } from '../runtime/whisper/whisperRuntime.js';
import { runTranscription } from '../transcription/transcribePipeline.js';
import { reportProgressApiName } from './browserApi.js';
import {
  type BrowserTranscribeRequest,
  type BrowserTranscribeResult,
  transcribeAudioApiName,
} from './transcribeApi.js';

const reportProgress = async (progress: number): Promise<void> => {
  const api: unknown = Reflect.get(globalThis, reportProgressApiName);
  if (typeof api !== 'function') {
    throw new Error('AI progress API is not initialized');
  }
  await Reflect.apply(api, undefined, [{ type: 'progress', progress }]);
};

const fetchMonoPcm = async (
  pcmUrl: string,
): Promise<Float32Array<ArrayBuffer>> => {
  const response = await fetch(pcmUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch transcription PCM: HTTP ${response.status}`,
    );
  }
  return new Float32Array(await response.arrayBuffer());
};

Reflect.set(
  globalThis,
  transcribeAudioApiName,
  async (
    request: BrowserTranscribeRequest,
  ): Promise<BrowserTranscribeResult> => {
    const audio = await fetchMonoPcm(request.pcmUrl);
    await reportProgress(0.02);

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
