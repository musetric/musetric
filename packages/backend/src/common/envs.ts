import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLogLevel, type LogLevel } from '@musetric/utils';
import { createStoragePaths } from '@musetric/utils/node';

const rootPath = join(dirname(fileURLToPath(import.meta.url)), '../../');
const storagePaths = createStoragePaths(rootPath);

const getLogLevel = (): LogLevel => {
  const level = process.env.LOG_LEVEL;
  return isLogLevel(level) ? level : 'info';
};

export const envs = {
  version: process.env.VERSION ?? '0.1.0',
  host: process.env.HOST ?? '0.0.0.0',
  port: process.env.PORT ? Number(process.env.PORT) : 3000,
  logLevel: getLogLevel(),
  protocol: process.env.PROTOCOL === 'http' ? 'http' : 'https',
  ...storagePaths,
  gcIntervalMs: 5 * 60 * 1000,
  blobRetentionMs: 5 * 60 * 1000,
  processingIntervalMs: 10 * 1000,
};
