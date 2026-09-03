const logLevels = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof logLevels)[number];

export const isLogLevel = (logLevel?: string): logLevel is LogLevel =>
  logLevels.some((level) => level === logLevel);
