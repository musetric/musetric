import { join } from 'node:path';
import { createStoragePaths } from '@musetric/utils/node';
import { app } from 'electron';
import { type Logger } from 'pino';
import { type DesktopBackend } from './backendRunner.js';
import { startServerProcess } from './serverProcess.js';
import { acquireStorageLock } from './storageLock.js';

const createLockPath = (): string =>
  join(app.getPath('userData'), 'storage/backend.lock');

export type StartBackendOptions = {
  logger: Logger;
};

export const startBackend = async (
  options: StartBackendOptions,
): Promise<DesktopBackend | undefined> => {
  const storagePaths = createStoragePaths(app.getPath('userData'));
  const resourcePaths = createStoragePaths(join(app.getAppPath(), '../server'));
  const storageLock = acquireStorageLock(createLockPath());
  if (!storageLock) {
    return undefined;
  }
  try {
    const server = await startServerProcess({
      databasePath: storagePaths.databasePath,
      blobsPath: storagePaths.blobsPath,
      modelsPath: storagePaths.modelsPath,
      browserBundlePath: resourcePaths.browserBundlePath,
      publicPath: resourcePaths.publicPath,
      resourcesPath: app.isPackaged ? process.resourcesPath : undefined,
      onLog: (line) => {
        options.logger.info({ scope: 'rustServer' }, line);
      },
    });
    return {
      url: server.url,
      migration: server.migration,
      close: async () => {
        try {
          await server.close();
        } finally {
          storageLock.release();
        }
      },
    };
  } catch (error) {
    storageLock.release();
    throw error;
  }
};
