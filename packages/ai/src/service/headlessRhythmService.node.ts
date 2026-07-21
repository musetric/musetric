import { type Logger } from '@musetric/utils';
import { type GpuPageProgressHandler } from './gpuPageHost.node.js';
import { runGpuAnalysis } from './headlessGpuPage.node.js';
import {
  analyzeRhythmApiName,
  type BrowserAnalyzeRhythmRequest,
  type BrowserAnalyzeRhythmResult,
} from './rhythmApi.js';

export type HeadlessRhythmAnalysisOptions = {
  logger: Logger;
  pcm: Buffer;
  modelPath: string;
  filterbankPath: string;
  onProgress: GpuPageProgressHandler;
};

export type RhythmLogits = {
  beat: Float32Array;
  downbeat: Float32Array;
};

export const analyzeRhythmHeadless = async (
  options: HeadlessRhythmAnalysisOptions,
): Promise<RhythmLogits> => {
  const { logger, pcm, modelPath, filterbankPath } = options;
  const logits = await runGpuAnalysis<
    BrowserAnalyzeRhythmRequest,
    BrowserAnalyzeRhythmResult
  >({
    logger,
    label: 'Headless rhythm analysis',
    apiName: analyzeRhythmApiName,
    requireShaderF16: false,
    pcm,
    onProgress: options.onProgress,
    buildRequest: (server) => ({
      pcmUrl: server.pcmUrl,
      modelUrl: server.registerFile(modelPath),
      filterbankUrl: server.registerFile(filterbankPath),
    }),
  });
  return {
    beat: Float32Array.from(logits.beat),
    downbeat: Float32Array.from(logits.downbeat),
  };
};
