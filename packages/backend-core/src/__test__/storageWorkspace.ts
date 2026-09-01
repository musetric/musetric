import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { initDatabase } from '@musetric/backend-db/migrations';
import { createBlobStorage, createStoragePaths } from '@musetric/utils/node';
import { type AppConfig } from '../common/config.js';

const blobTimestamp = new Date('2020-01-01T00:00:00.000Z');

export type StorageWorkspace = {
  config: AppConfig;
  addBlob: (content: Buffer) => Promise<string>;
  remove: () => void;
};

export const createStorageWorkspace = (): StorageWorkspace => {
  const rootPath = mkdtempSync(join(tmpdir(), 'musetric-api-'));
  const config: AppConfig = {
    ...createStoragePaths(rootPath),
    version: 'test',
    logLevel: 'error',
    logDestination: { write: () => undefined },
  };
  mkdirSync(config.blobsPath, { recursive: true });
  mkdirSync(config.publicPath, { recursive: true });
  mkdirSync(dirname(config.databasePath), { recursive: true });
  writeFileSync(join(config.publicPath, 'index.html'), '<!doctype html>\n');
  initDatabase(config.databasePath);
  const blobStorage = createBlobStorage(config.blobsPath);

  return {
    config,
    addBlob: async (content) => {
      const blobId = await blobStorage.add(content);
      utimesSync(blobStorage.getPath(blobId), blobTimestamp, blobTimestamp);
      return blobId;
    },
    remove: () => {
      rmSync(rootPath, { recursive: true, force: true });
    },
  };
};
