import { type Logger, type MessageHandlers } from '@musetric/utils';
import { spawnScript } from '@musetric/utils/node';

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
};

export const transcribeAudio = async (
  options: TranscribeAudioOptions,
): Promise<void> => {
  const { sourcePath, resultPath, handlers, logger, modelsPath } = options;

  await spawnScript<TranscribeAudioMessage>({
    command: 'musetric-transcribe',
    args: {
      '--audio-path': sourcePath,
      '--result-path': resultPath,
      '--models-path': modelsPath,
      '--log-level': logger.level ?? 'info',
    },
    stdout: { mode: 'json', handlers },
    stderr: { mode: 'logJson' },
    logger,
    processName: 'transcribeAudio',
  });
};
