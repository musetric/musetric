import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { type Logger } from '@musetric/utils';
import { spawnScript } from '@musetric/utils/node';

const fragmentDurationSeconds = 2;

export const fmp4AudioOutput = {
  format: 'mp4',
  contentType: 'audio/mp4',
} as const;

export type ConvertToFmp4Options = {
  fromPath: string;
  toPath: string;
  sampleRate: number;
  logger: Logger;
};

export const convertToFmp4 = async (
  options: ConvertToFmp4Options,
): Promise<void> => {
  const { fromPath, toPath, sampleRate, logger } = options;
  const fragmentDurationMicros = fragmentDurationSeconds * 1_000_000;
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
      '-ar',
      sampleRate.toString(),
      '-c:a',
      'aac',
      '-profile:a',
      'aac_low',
      '-b:a',
      '256k',
      '-f',
      'mp4',
      '-movflags',
      '+frag_keyframe+empty_moov+default_base_moof',
      '-frag_duration',
      fragmentDurationMicros.toString(),
      '-min_frag_duration',
      fragmentDurationMicros.toString(),
      toPath,
    ],
    stderr: { mode: 'logText' },
    logger,
    processName: 'convertToFmp4',
  });
};
