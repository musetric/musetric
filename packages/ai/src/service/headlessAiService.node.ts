import { basename } from 'node:path';
import { type Logger } from '@musetric/utils';
import { type SeparateAudioMessage } from '../separation/separateAudio.node.js';
import {
  type BrowserSeparateAudioRequest,
  separateAudioApiName,
  stemDownloadNames,
  type StemKey,
} from './browserApi.js';
import { runGpuAnalysis } from './headlessGpuPage.node.js';
import { type SeparationModelFiles } from './modelCache.node.js';

type ProgressMessageHandler = (
  message: Extract<SeparateAudioMessage, { type: 'progress' }>,
) => void | Promise<void>;

type HeadlessSeparateAudioOptions = {
  logger: Logger;
  pcm: Buffer;
  sampleRate: number;
  modelFiles: SeparationModelFiles;
  rawStemPaths: Record<StemKey, string>;
  onMessage: ProgressMessageHandler;
};

export const separateAudioHeadless = async (
  options: HeadlessSeparateAudioOptions,
): Promise<void> => {
  const { logger, pcm, sampleRate, modelFiles, rawStemPaths, onMessage } =
    options;
  const stemTargets = new Map<string, string>([
    [stemDownloadNames.lead, rawStemPaths.lead],
    [stemDownloadNames.backing, rawStemPaths.backing],
    [stemDownloadNames.instrumental, rawStemPaths.instrumental],
  ]);
  await runGpuAnalysis<BrowserSeparateAudioRequest, void>({
    logger,
    label: 'Headless AI separation',
    apiName: separateAudioApiName,
    requireShaderF16: true,
    pcm,
    onProgress: async (progress) => {
      await onMessage({ type: 'progress', progress });
    },
    buildRequest: (server) => ({
      pcmUrl: server.pcmUrl,
      sampleRate,
      vocalsModelUrl: server.registerFile(modelFiles.vocalsModelPath),
      vocalsModelDataUrl: server.registerFile(modelFiles.vocalsModelDataPath),
      vocalsModelDataPath: basename(modelFiles.vocalsModelDataPath),
      leadBackingModelUrl: server.registerFile(modelFiles.leadBackingModelPath),
    }),
    run: async (page, request) => {
      const downloadsSaved = page.captureDownloads(stemTargets);
      await page.evaluate<void>(request);
      await downloadsSaved;
    },
  });
};
