import { join } from 'node:path';

export type StoragePaths = {
  blobsPath: string;
  publicPath: string;
  databasePath: string;
  modelsPath: string;
  browserBundlePath: string;
};

export const createStoragePaths = (rootPath: string): StoragePaths => ({
  blobsPath: join(rootPath, 'storage/blobs'),
  publicPath: join(rootPath, 'storage/public'),
  databasePath: join(rootPath, 'storage/db/app.db'),
  modelsPath: join(rootPath, 'storage/models'),
  browserBundlePath: join(rootPath, 'dist-browser'),
});
