import { type Logger, type MessageHandlers } from '@musetric/utils';
import { spawnScript } from '@musetric/utils/node';

export type AnalyzeRhythmMessage =
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

export type AnalyzeRhythmOptions = {
  sourcePath: string;
  resultPath: string;
  handlers: MessageHandlers<AnalyzeRhythmMessage>;
  logger: Logger;
  modelsPath: string;
};

export const analyzeRhythm = async (
  options: AnalyzeRhythmOptions,
): Promise<void> => {
  const { sourcePath, resultPath, handlers, logger, modelsPath } = options;

  await spawnScript<AnalyzeRhythmMessage>({
    command: 'musetric-rhythm',
    args: {
      '--audio-path': sourcePath,
      '--result-path': resultPath,
      '--models-path': modelsPath,
      '--log-level': logger.level ?? 'info',
    },
    stdout: { mode: 'json', handlers },
    stderr: { mode: 'logJson' },
    logger,
    processName: 'analyzeRhythm',
  });
};
