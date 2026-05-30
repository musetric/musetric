import { type Logger, type MessageHandlers } from '@musetric/resource-utils';
import { vocalsModel } from '../models/vocalsModel.js';
import {
  readAudioFile,
  writeFlacAudioFile,
} from '../service/audioFile.node.js';
import { separateAudioHeadless } from '../service/headlessAiService.node.js';
import { ensureSeparationModelFiles } from '../service/modelCache.node.js';

export type SeparateAudioMessage =
  | {
      type: 'progress';
      progress: number;
    }
  | {
      type: 'download';
      label: string;
      file?: string;
      downloaded: number;
      total?: number;
      status?: 'processing' | 'cached' | 'done';
    };

export type SeparateAudioOptions = {
  sourcePath: string;
  leadPath: string;
  backingPath: string;
  instrumentalPath: string;
  sampleRate: number;
  handlers: MessageHandlers<SeparateAudioMessage>;
  logger: Logger;
  modelsPath: string;
};

export const separateAudio = async (
  options: SeparateAudioOptions,
): Promise<void> => {
  const {
    sourcePath,
    leadPath,
    backingPath,
    instrumentalPath,
    sampleRate,
    handlers,
    logger,
    modelsPath,
  } = options;

  const modelFiles = await ensureSeparationModelFiles({
    handlers,
    modelsPath,
  });
  const sourceAudio = await readAudioFile({
    sourcePath,
    sampleRate: vocalsModel.sampleRate,
    logger,
  });
  const result = await separateAudioHeadless({
    logger,
    audio: sourceAudio,
    modelFiles,
    onMessage: async (message) => {
      await handlers[message.type](message);
    },
  });

  await Promise.all([
    writeFlacAudioFile({
      audio: result.lead,
      outputSampleRate: sampleRate,
      outputPath: leadPath,
      logger,
    }),
    writeFlacAudioFile({
      audio: result.backing,
      outputSampleRate: sampleRate,
      outputPath: backingPath,
      logger,
    }),
    writeFlacAudioFile({
      audio: result.instrumental,
      outputSampleRate: sampleRate,
      outputPath: instrumentalPath,
      logger,
    }),
  ]);
};
