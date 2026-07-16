import { type Logger } from '@musetric/utils';
import {
  analyzeChordsApiName,
  type BrowserAnalyzeChordsRequest,
  type BrowserAnalyzeChordsResult,
  releaseChordsApiName,
} from './chordsApi.js';
import { type GpuProgressHandler } from './headlessGpuBrowser.node.js';
import {
  createHeadlessGpuService,
  type HeadlessGpuService,
} from './headlessGpuService.node.js';

export type HeadlessChordAnalysisOptions = {
  pcm: Buffer;
  modelPath: string;
  planPath: string;
  planManifestPath?: string;
  onProgress: GpuProgressHandler;
};

export type HeadlessChordsService = {
  analyze: (options: HeadlessChordAnalysisOptions) => Promise<Int32Array>;
  close: () => Promise<void>;
};

export type CreateHeadlessChordsServiceOptions = {
  logger: Logger;
};

type ChordsGpuService = HeadlessGpuService<
  BrowserAnalyzeChordsRequest,
  BrowserAnalyzeChordsResult
>;

export const createHeadlessChordsService = async (
  options: CreateHeadlessChordsServiceOptions,
): Promise<HeadlessChordsService> => {
  const service: ChordsGpuService = await createHeadlessGpuService({
    logger: options.logger,
    label: 'Headless chords service',
    pageRoute: '/chords-service',
    entryModule: 'src/service/browserChordsEntry.ts',
    analyzeApiName: analyzeChordsApiName,
    releaseApiName: releaseChordsApiName,
  });

  const analyze = async (
    analysisOptions: HeadlessChordAnalysisOptions,
  ): Promise<Int32Array> => {
    const { pcm, modelPath, planPath, planManifestPath, onProgress } =
      analysisOptions;
    const indices = await service.run({
      pcm,
      onProgress,
      buildRequest: (urls) => {
        const { pcmUrl, registerFile } = urls;
        return {
          pcmUrl,
          modelUrl: registerFile(modelPath),
          planUrl: registerFile(planPath),
          planManifestUrl:
            planManifestPath === undefined
              ? undefined
              : registerFile(planManifestPath),
        };
      },
    });
    return Int32Array.from(indices);
  };

  return { analyze, close: service.close };
};
