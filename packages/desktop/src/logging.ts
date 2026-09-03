import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { app, dialog } from 'electron';
import { destination, type Logger, pino, stdSerializers } from 'pino';

const keptRunCount = 20;
const logExtension = '.log';

const createRunFileName = (): string =>
  `${new Date().toISOString().replaceAll(':', '-')}${logExtension}`;

const pruneRuns = (logsPath: string): void => {
  const runs = readdirSync(logsPath)
    .filter((name) => name.endsWith(logExtension))
    .sort((left, right) => left.localeCompare(right));
  for (const name of runs.slice(0, runs.length - keptRunCount + 1)) {
    rmSync(join(logsPath, name), { force: true });
  }
};

export type DesktopLog = {
  logger: Logger;
  path: string;
};

export const createDesktopLog = (logsPath: string): DesktopLog => {
  mkdirSync(logsPath, { recursive: true });
  pruneRuns(logsPath);
  const path = join(logsPath, createRunFileName());
  const logDestination = destination({ dest: path, sync: true });
  const logger = pino(
    {
      serializers: {
        error: stdSerializers.err,
        err: stdSerializers.err,
      },
      errorKey: 'error',
      level: 'info',
    },
    logDestination,
  );
  logger.info(
    {
      version: app.getVersion(),
      electron: process.versions.electron,
      platform: process.platform,
      arch: process.arch,
      packaged: app.isPackaged,
      userData: app.getPath('userData'),
    },
    'app starting',
  );
  return { logger, path };
};

export const reportFatal = (
  log: DesktopLog,
  message: string,
  error: unknown,
): void => {
  log.logger.fatal({ error }, message);
  dialog.showErrorBox(
    'Musetric stopped',
    `${message}\n\nThe details are in ${log.path}`,
  );
};

export const watchFatalEvents = (
  log: DesktopLog,
  onFatal: () => void,
): void => {
  process.on('uncaughtException', (error) => {
    reportFatal(log, 'uncaught exception in the main process', error);
    onFatal();
  });
  process.on('unhandledRejection', (reason) => {
    reportFatal(log, 'unhandled rejection in the main process', reason);
    onFatal();
  });
  app.on('render-process-gone', (_event, contents, details) => {
    log.logger.error(
      { ...details, url: contents.getURL() },
      'render process gone',
    );
  });
  app.on('child-process-gone', (_event, details) => {
    log.logger.error({ ...details }, 'child process gone');
  });
  app.on('quit', (_event, exitCode) => {
    log.logger.info({ exitCode }, 'app quit');
  });
};
