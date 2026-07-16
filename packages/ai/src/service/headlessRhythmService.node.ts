import { type Logger } from '@musetric/utils';
import { type GpuProgressHandler } from './headlessGpuBrowser.node.js';
import {
  createHeadlessGpuService,
  type HeadlessGpuService,
} from './headlessGpuService.node.js';
import {
  analyzeRhythmApiName,
  type BrowserAnalyzeRhythmRequest,
  type BrowserAnalyzeRhythmResult,
  releaseRhythmApiName,
} from './rhythmApi.js';

export type HeadlessRhythmAnalysisOptions = {
  pcm: Buffer;
  modelPath: string;
  filterbankPath: string;
  onProgress: GpuProgressHandler;
};

export type RhythmLogits = {
  beat: Float32Array;
  downbeat: Float32Array;
};

export type HeadlessRhythmService = {
  analyze: (options: HeadlessRhythmAnalysisOptions) => Promise<RhythmLogits>;
  close: () => Promise<void>;
};

export type CreateHeadlessRhythmServiceOptions = {
  logger: Logger;
};

type RhythmGpuService = HeadlessGpuService<
  BrowserAnalyzeRhythmRequest,
  BrowserAnalyzeRhythmResult
>;

export const createHeadlessRhythmService = async (
  options: CreateHeadlessRhythmServiceOptions,
): Promise<HeadlessRhythmService> => {
  const service: RhythmGpuService = await createHeadlessGpuService({
    logger: options.logger,
    label: 'Headless rhythm service',
    pageRoute: '/rhythm-service',
    entryModule: 'src/service/browserRhythmEntry.ts',
    analyzeApiName: analyzeRhythmApiName,
    releaseApiName: releaseRhythmApiName,
  });

  const analyze = async (
    analysisOptions: HeadlessRhythmAnalysisOptions,
  ): Promise<RhythmLogits> => {
    const { pcm, modelPath, filterbankPath, onProgress } = analysisOptions;
    const logits = await service.run({
      pcm,
      onProgress,
      buildRequest: (urls) => {
        const { pcmUrl, registerFile } = urls;
        return {
          pcmUrl,
          modelUrl: registerFile(modelPath),
          filterbankUrl: registerFile(filterbankPath),
        };
      },
    });
    return {
      beat: Float32Array.from(logits.beat),
      downbeat: Float32Array.from(logits.downbeat),
    };
  };

  return { analyze, close: service.close };
};
