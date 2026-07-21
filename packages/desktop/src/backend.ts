import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { DB } from '@musetric/backend-db';
import { createTables } from '@musetric/backend-db/migrations';
import { createStoragePaths } from '@musetric/utils/node';

const backendRoot = dirname(
  createRequire(import.meta.url).resolve('@musetric/backend/package.json'),
);
const { databasePath } = createStoragePaths(backendRoot);

const port = Number(process.env.MUSETRIC_DESKTOP_PORT ?? 3000);

export const backendUrl = `http://127.0.0.1:${port}`;

const configureBackendEnvironment = (): void => {
  process.env.PROTOCOL = 'http';
  process.env.HOST = '127.0.0.1';
  process.env.PORT = String(port);
};

const initDatabase = async (): Promise<void> => {
  const database = await DB.createDatabase(databasePath);
  try {
    await createTables(database);
  } finally {
    if (database.isOpen) {
      database.close();
    }
  }
};

export type DesktopBackend = {
  close: () => Promise<void>;
};

export const startBackend = async (): Promise<DesktopBackend> => {
  configureBackendEnvironment();
  await initDatabase();
  const { createServerApp } = await import('@musetric/backend');
  const backend = await createServerApp();
  await backend.listen({
    port,
    host: '127.0.0.1',
  });
  return backend;
};
