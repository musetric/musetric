import { type Logger } from '@musetric/resource-utils';
import { spawnScript } from '@musetric/resource-utils/node';

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
          durationSeconds = Number(trimmed);
        }
      },
    },
    stderr: { mode: 'logText' },
    logger,
    processName: 'getAudioFrameCount',
  });

  if (
    !durationSeconds ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds < 0
  ) {
    throw new Error('Invalid audio duration');
  }

  const frameCount = Math.floor(durationSeconds * sampleRate);
  if (!frameCount || !Number.isFinite(frameCount) || frameCount < 0) {
    throw new Error('Invalid audio frame count');
  }
  return frameCount;
};
