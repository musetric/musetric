import { type LogLevel } from '@musetric/utils';
import { type FastifyLoggerOptions } from 'fastify';
import { type LoggerOptions, stdSerializers } from 'pino';
import PinoPretty from 'pino-pretty';

export const createLoggerOptions = (
  logLevel: LogLevel,
): FastifyLoggerOptions & LoggerOptions => ({
  serializers: {
    error: stdSerializers.err,
    err: stdSerializers.err,
  },
  errorKey: 'error',
  stream: PinoPretty({
    colorize: true,
    translateTime: 'HH:MM:ss.l',
    ignore: 'pid,hostname',
  }),
  level: logLevel,
});
