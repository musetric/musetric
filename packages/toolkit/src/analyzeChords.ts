import { type Logger, type MessageHandlers } from '@musetric/resource-utils';
import { spawnScript } from '@musetric/resource-utils/node';

export type AnalyzeChordsMessage =
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

export type AnalyzeChordsOptions = {
  sourcePath: string;
  resultPath: string;
  handlers: MessageHandlers<AnalyzeChordsMessage>;
  logger: Logger;
  modelsPath: string;
};

export const analyzeChords = async (
  options: AnalyzeChordsOptions,
): Promise<void> => {
  const { sourcePath, resultPath, handlers, logger, modelsPath } = options;

  await spawnScript<AnalyzeChordsMessage>({
    command: 'musetric-chords',
    args: {
      '--audio-path': sourcePath,
      '--result-path': resultPath,
      '--models-path': modelsPath,
      '--log-level': logger.level ?? 'info',
    },
    stdout: { mode: 'json', handlers },
    stderr: { mode: 'logJson' },
    logger,
    processName: 'analyzeChords',
  });
};
