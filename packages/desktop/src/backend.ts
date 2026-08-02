import { join } from 'node:path';
import { type GpuPageHostFactory } from '@musetric/ai/node';
import { type AppConfig } from '@musetric/backend-core/config';
import { initDatabase } from '@musetric/backend-db/migrations';
import { createStoragePaths } from '@musetric/utils/node';
import { app } from 'electron';
import { acquireStorageLock } from './storageLock.js';

const requestedPort = Number(process.env.MUSETRIC_DESKTOP_PORT ?? 0);

const createDesktopConfig = (): AppConfig => {
  const resourcePaths = createStoragePaths(
    join(app.getAppPath(), '../backend'),
  );
  return {
    ...createStoragePaths(app.getPath('userData')),
    version: app.getVersion(),
    logLevel: 'info',
    publicPath: resourcePaths.publicPath,
    browserBundlePath: resourcePaths.browserBundlePath,
  };
};

export type DesktopBackend = {
  url: string;
  close: () => Promise<void>;
};

export type StartBackendOptions = {
  gpuPageHostFactory: GpuPageHostFactory;
};

export const startBackend = async (
  options: StartBackendOptions,
): Promise<DesktopBackend | undefined> => {
  const config = createDesktopConfig();
  const storageLock = acquireStorageLock(config.lockPath);
  if (!storageLock) {
    return undefined;
  }
  try {
    await initDatabase(config.databasePath);
    const { createServerApp } = await import('@musetric/backend-core');
    const backend = await createServerApp(config, {
      gpuPageHostFactory: options.gpuPageHostFactory,
    });
    await backend.listen({
      port: requestedPort,
      host: '127.0.0.1',
    });
    const address = backend.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('desktop backend failed to bind a local HTTP port');
    }
    return {
      url: `http://127.0.0.1:${address.port}`,
      close: async () => {
        try {
          await backend.close();
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
