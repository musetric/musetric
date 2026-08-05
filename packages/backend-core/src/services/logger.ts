import { type LogLevel } from '@musetric/utils';
import { type FastifyLoggerOptions } from 'fastify';
import {
  type DestinationStream,
  type LoggerOptions,
  stdSerializers,
} from 'pino';
import PinoPretty from 'pino-pretty';

export const createLoggerOptions = (
  logLevel: LogLevel,
  logDestination?: DestinationStream,
): FastifyLoggerOptions & LoggerOptions => ({
  serializers: {
    error: stdSerializers.err,
    err: stdSerializers.err,
  },
  errorKey: 'error',
  stream:
    logDestination ??
    PinoPretty({
      colorize: true,
      translateTime: 'HH:MM:ss.l',
      ignore: 'pid,hostname',
    }),
  level: logLevel,
});
