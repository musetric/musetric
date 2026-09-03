import { join } from 'node:path';
import { ffmpegPath, ffprobePath } from '@musetric/ffmpeg';
import { type OpenGpuPage, startRustProxy } from '@musetric/server';
import { createStoragePaths } from '@musetric/utils/node';
import { app } from 'electron';
import { type Logger } from 'pino';
import { type DesktopBackend } from './backendRunner.js';
import { acquireStorageLock } from './storageLock.js';

const createLockPath = (): string =>
  join(app.getPath('userData'), 'storage/backend.lock');

export type StartBackendOptions = {
  openPage: OpenGpuPage;
  logger: Logger;
};

export const startBackend = async (
  options: StartBackendOptions,
): Promise<DesktopBackend | undefined> => {
  const storagePaths = createStoragePaths(app.getPath('userData'));
  const resourcePaths = createStoragePaths(
    join(app.getAppPath(), '../backend'),
  );
  const storageLock = acquireStorageLock(createLockPath());
  if (!storageLock) {
    return undefined;
  }
  try {
    const server = await startRustProxy({
      listen: '127.0.0.1:0',
      databasePath: storagePaths.databasePath,
      blobsPath: storagePaths.blobsPath,
      ffmpegPath: ffmpegPath(),
      ffprobePath: ffprobePath(),
      modelsPath: storagePaths.modelsPath,
      browserBundlePath: resourcePaths.browserBundlePath,
      publicPath: resourcePaths.publicPath,
      openPage: options.openPage,
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
