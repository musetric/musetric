import { type Logger } from '@musetric/utils';
import {
  analyzeChordsApiName,
  type BrowserAnalyzeChordsRequest,
  type BrowserAnalyzeChordsResult,
} from './chordsApi.js';
import { type GpuPageProgressHandler } from './gpuPageHost.node.js';
import { runGpuAnalysis } from './headlessGpuPage.node.js';

export type HeadlessChordAnalysisOptions = {
  logger: Logger;
  pcm: Buffer;
  modelPath: string;
  planPath: string;
  planManifestPath?: string;
  onProgress: GpuPageProgressHandler;
};

export const analyzeChordsHeadless = async (
  options: HeadlessChordAnalysisOptions,
): Promise<Int32Array> => {
  const { logger, pcm, modelPath, planPath, planManifestPath } = options;
  const indices = await runGpuAnalysis<
    BrowserAnalyzeChordsRequest,
    BrowserAnalyzeChordsResult
  >({
    logger,
    label: 'Headless chords analysis',
    apiName: analyzeChordsApiName,
    requireShaderF16: false,
    pcm,
    onProgress: options.onProgress,
    buildRequest: (server) => ({
      pcmUrl: server.pcmUrl,
      modelUrl: server.registerFile(modelPath),
      planUrl: server.registerFile(planPath),
      planManifestUrl:
        planManifestPath === undefined
          ? undefined
          : server.registerFile(planManifestPath),
    }),
  });
  return Int32Array.from(indices);
};
