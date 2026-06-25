import { type Logger, type MessageHandlers } from '@musetric/utils';
import { spawnScript } from '@musetric/utils/node';

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

export const separateAudio = async (options: SeparateAudioOptions) => {
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

  await spawnScript<SeparateAudioMessage>({
    command: 'musetric-separate',
    args: {
      '--source-path': sourcePath,
      '--lead-path': leadPath,
      '--backing-path': backingPath,
      '--instrumental-path': instrumentalPath,
      '--sample-rate': sampleRate.toString(),
      '--models-path': modelsPath,
      '--log-level': logger.level ?? 'info',
    },
    stdout: { mode: 'json', handlers },
    stderr: { mode: 'logJson' },
    logger,
    processName: 'separateAudio',
  });
};
