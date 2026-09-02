import { join } from 'node:path';
import { type OpenJobPage } from '@musetric/ai/node';
import { type AppConfig } from '@musetric/backend-core/config';
import { initDatabase } from '@musetric/backend-db/migrations';
import { ffmpegPath, ffprobePath } from '@musetric/ffmpeg';
import { startRustProxy } from '@musetric/server';
import { createStoragePaths } from '@musetric/utils/node';
import { app } from 'electron';
import { type FastifyInstance } from 'fastify';
import { type DestinationStream, type Logger } from 'pino';
import { type DesktopBackend } from './backendRunner.js';
import { acquireStorageLock } from './storageLock.js';

const createLockPath = (): string =>
  join(app.getPath('userData'), 'storage/backend.lock');

const createDesktopConfig = (logDestination: DestinationStream): AppConfig => {
  const resourcePaths = createStoragePaths(
    join(app.getAppPath(), '../backend'),
  );
  return {
    ...createStoragePaths(app.getPath('userData')),
    version: app.getVersion(),
    logLevel: 'info',
    logDestination,
    publicPath: resourcePaths.publicPath,
    browserBundlePath: resourcePaths.browserBundlePath,
  };
};

export type StartBackendOptions = {
  openPage: OpenJobPage;
  logDestination: DestinationStream;
  logger: Logger;
};

export const startBackend = async (
  options: StartBackendOptions,
): Promise<DesktopBackend | undefined> => {
  const config = createDesktopConfig(options.logDestination);
  const storageLock = acquireStorageLock(createLockPath());
  if (!storageLock) {
    return undefined;
  }
  let backend: FastifyInstance | undefined = undefined;
  try {
    const migration = initDatabase(config.databasePath);
    const { createServerApp } = await import('@musetric/backend-core');
    const fastify = await createServerApp(config, {
      openPage: options.openPage,
    });
    backend = fastify;
    await fastify.listen({
      port: 0,
      host: '127.0.0.1',
    });
    const address = fastify.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('desktop backend failed to bind a local HTTP port');
    }
    const proxy = await startRustProxy({
      upstream: `http://127.0.0.1:${String(address.port)}`,
      listen: '127.0.0.1:0',
      databasePath: config.databasePath,
      blobsPath: config.blobsPath,
      ffmpegPath: ffmpegPath(),
      ffprobePath: ffprobePath(),
      modelsPath: config.modelsPath,
      browserBundlePath: config.browserBundlePath,
      resourcesPath: app.isPackaged ? process.resourcesPath : undefined,
      onLog: (line) => {
        options.logger.info({ scope: 'rustProxy' }, line);
      },
    });
    return {
      url: proxy.url,
      migration,
      close: async () => {
        try {
          await proxy.close();
        } finally {
          try {
            await fastify.close();
          } finally {
            storageLock.release();
          }
        }
      },
    };
  } catch (error) {
    try {
      await backend?.close();
    } finally {
      storageLock.release();
    }
    throw error;
  }
};
