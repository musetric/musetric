import { join } from 'node:path';
import { type GpuPageHostFactory } from '@musetric/ai/node';
import { type AppConfig } from '@musetric/backend-core/config';
import { DB } from '@musetric/backend-db';
import { createTables } from '@musetric/backend-db/migrations';
import { createStoragePaths } from '@musetric/utils/node';
import { app } from 'electron';

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

const initDatabase = async (config: AppConfig): Promise<void> => {
  const database = await DB.createDatabase(config.databasePath);
  try {
    await createTables(database);
  } finally {
    if (database.isOpen) {
      database.close();
    }
  }
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
): Promise<DesktopBackend> => {
  const config = createDesktopConfig();
  await initDatabase(config);
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
      await backend.close();
    },
  };
};
