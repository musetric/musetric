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
