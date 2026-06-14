import { rm } from 'node:fs/promises';
import { type Logger, type MessageHandlers } from '@musetric/resource-utils';
import { vocalsModel } from '../models/vocalsModel.js';
import {
  decodeInterleavedPcm,
  encodeFlacFromRawFile,
} from '../service/audioCodec.node.js';
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

  const modelFiles = await ensureSeparationModelFiles({ handlers, modelsPath });

  const pcm = await decodeInterleavedPcm({
    sourcePath,
    sampleRate: vocalsModel.sampleRate,
    logger,
  });

  const rawStemPaths = {
    lead: `${leadPath}.raw`,
    backing: `${backingPath}.raw`,
    instrumental: `${instrumentalPath}.raw`,
  };
  try {
    await separateAudioHeadless({
      logger,
      pcm,
      sampleRate: vocalsModel.sampleRate,
      modelFiles,
      rawStemPaths,
      onMessage: async (message) => {
        await handlers[message.type](message);
      },
    });

    const stemEncodes = [
      { rawPath: rawStemPaths.lead, outputPath: leadPath },
      { rawPath: rawStemPaths.backing, outputPath: backingPath },
      { rawPath: rawStemPaths.instrumental, outputPath: instrumentalPath },
    ];
    await Promise.all(
      stemEncodes.map(async (stem) =>
        encodeFlacFromRawFile({
          rawPath: stem.rawPath,
          inputSampleRate: vocalsModel.sampleRate,
          outputSampleRate: sampleRate,
          outputPath: stem.outputPath,
          logger,
        }),
      ),
    );
  } finally {
    await Promise.all(
      Object.values(rawStemPaths).map(async (path) =>
        rm(path, { force: true }),
      ),
    );
  }
};
