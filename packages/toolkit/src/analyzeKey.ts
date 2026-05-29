import { type Logger, type MessageHandlers } from '@musetric/resource-utils';
import { spawnScript } from '@musetric/resource-utils/node';

export type AnalyzeKeyMessage =
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

export type AnalyzeKeyOptions = {
  sourcePath: string;
  resultPath: string;
  handlers: MessageHandlers<AnalyzeKeyMessage>;
  logger: Logger;
  modelsPath: string;
};

export const analyzeKey = async (options: AnalyzeKeyOptions): Promise<void> => {
  const { sourcePath, resultPath, handlers, logger, modelsPath } = options;

  await spawnScript<AnalyzeKeyMessage>({
    command: 'musetric-key',
    args: {
      '--audio-path': sourcePath,
      '--result-path': resultPath,
      '--models-path': modelsPath,
      '--log-level': logger.level ?? 'info',
    },
    stdout: { mode: 'json', handlers },
    stderr: { mode: 'logJson' },
    logger,
    processName: 'analyzeKey',
  });
};
