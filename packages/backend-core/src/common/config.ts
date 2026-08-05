import { type ServerOptions } from 'node:https';
import { type LogLevel } from '@musetric/utils';
import { type StoragePaths } from '@musetric/utils/node';
import { type DestinationStream } from 'pino';

export type AppConfig = StoragePaths & {
  version: string;
  logLevel: LogLevel;
  logDestination?: DestinationStream;
  https?: ServerOptions;
};

export const gcIntervalMs = 5 * 60 * 1000;
export const blobRetentionMs = 5 * 60 * 1000;
export const processingIntervalMs = 10 * 1000;
