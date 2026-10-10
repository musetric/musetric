import { trackPitch } from '@musetric/spectrogram/gpu';
import { defaultSampleRate } from '@musetric/utils';
import { getMusetricWebGpuDevice } from '../runtime/webgpuDevice.js';
import { measureVoiceRange } from '../voiceRange/voiceRange.js';
import { createBrowserJobApi } from './browserJob.js';
import { floatsFromBytes, jsonBytes } from './browserShared.js';
import { type BrowserAnalyzeVoiceRangeRequest } from './voiceRangeApi.js';

export const analyzeVoiceRange =
  createBrowserJobApi<BrowserAnalyzeVoiceRangeRequest>(
    async (request, context) => {
      const { device } = await getMusetricWebGpuDevice();
      await context.serveUnits({
        attemptId: request.attemptId,
        attemptUrl: request.attemptUrl,
        outputs: request.outputs,
        run: async (bytes) => {
          const samples = floatsFromBytes(bytes);
          const line = await trackPitch({ device, samples });
          return jsonBytes(
            measureVoiceRange({ samples, sampleRate: defaultSampleRate, line }),
          );
        },
      });
    },
  );
