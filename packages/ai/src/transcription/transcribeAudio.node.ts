import { writeFile } from 'node:fs/promises';
import { type Logger, type MessageHandlers } from '@musetric/utils';
import { whisperModel } from '../models/whisperModel.js';
import { decodeMonoPcm } from '../service/audioCodec.node.js';
import { transcribeAudioHeadless } from '../service/headlessTranscriptionService.node.js';
import { ensureWhisperModelFiles } from '../service/whisperModelCache.node.js';

const whisperSampleRate = 16000;

export type TranscribeAudioMessage =
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

export type TranscribeAudioOptions = {
  sourcePath: string;
  resultPath: string;
  handlers: MessageHandlers<TranscribeAudioMessage>;
  logger: Logger;
  modelsPath: string;

  language?: string;
};

export const transcribeAudio = async (
  options: TranscribeAudioOptions,
): Promise<void> => {
  const { sourcePath, resultPath, handlers, logger, modelsPath, language } =
    options;

  const pcm = await decodeMonoPcm({
    sourcePath,
    sampleRate: whisperSampleRate,
    logger,
  });

  await ensureWhisperModelFiles({ modelsPath, handlers });

  const segments = await transcribeAudioHeadless({
    logger,
    pcm,
    sampleRate: whisperSampleRate,
    modelId: whisperModel.modelId,
    revision: whisperModel.revision,
    language,
    modelsPath,
    onProgress: async (progress) => {
      await handlers.progress({ type: 'progress', progress });
    },
  });

  await writeFile(resultPath, JSON.stringify(segments, undefined, 2), 'utf-8');
};
