export type LogContext = Record<string, unknown>;

export type LogMethod = {
  (message: string): void;
  (context: LogContext, message?: string): void;
};

const logLevels = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof logLevels)[number];

export type Logger = {
  debug: LogMethod;
  info: LogMethod;
  warn: LogMethod;
  error: LogMethod;
  level?: LogLevel;
};

export const isLogLevel = (logLevel?: string): logLevel is LogLevel =>
  logLevels.some((level) => level === logLevel);

export const bindLogger = <T extends Omit<Logger, 'level'>>(
  logger: T,
  level?: LogLevel,
): Logger => ({
  debug: logger.debug.bind(logger),
  info: logger.info.bind(logger),
  warn: logger.warn.bind(logger),
  error: logger.error.bind(logger),
  level,
});
