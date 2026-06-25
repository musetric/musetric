import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { type Logger } from '@musetric/utils';
import { spawnScript } from '@musetric/utils/node';

export const flacAudioOutput = {
  format: 'flac',
  contentType: 'audio/flac',
} as const;

export type ConvertToFlacOptions = {
  fromPath: string;
  toPath: string;
  sampleRate: number;
  logger: Logger;
};

export const convertToFlac = async (
  options: ConvertToFlacOptions,
): Promise<void> => {
  const { fromPath, toPath, sampleRate, logger } = options;
  await mkdir(dirname(toPath), { recursive: true });

  await spawnScript({
    command: 'ffmpeg',
    flatArgs: [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      fromPath,
      '-map',
      '0:a:0',
      '-sn',
      '-dn',
      '-vn',
      '-acodec',
      'flac',
      '-f',
      'flac',
      '-ar',
      sampleRate.toString(),
      toPath,
    ],
    stderr: { mode: 'logText' },
    logger,
    processName: 'convertToFlac',
  });
};
