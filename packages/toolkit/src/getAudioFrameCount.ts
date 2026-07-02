import { type Logger } from '@musetric/utils';
import { spawnScript } from '@musetric/utils/node';

export const getAudioFrameCount = async (
  fromPath: string,
  sampleRate: number,
  logger: Logger,
): Promise<number> => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  let durationSeconds = undefined as number | undefined;

  await spawnScript({
    command: 'ffprobe',
    flatArgs: [
      '-v',
      'error',
      '-select_streams',
      'a:0',
      '-show_entries',
      'format=duration',
      '-of',
      'default=nk=1:nw=1',
      fromPath,
    ],
    stdout: {
      mode: 'text',
      onLine: (line) => {
        const trimmed = line.trim();
        if (trimmed && !durationSeconds) {
          const rawValue = Number(trimmed);
          if (Number.isFinite(rawValue)) {
            durationSeconds = rawValue;
          }
        }
      },
    },
    stderr: { mode: 'logText' },
    logger,
    processName: 'getAudioFrameCount',
  });

  if (!durationSeconds) {
    throw new Error('Invalid audio duration');
  }

  return Math.floor(durationSeconds * sampleRate);
};
