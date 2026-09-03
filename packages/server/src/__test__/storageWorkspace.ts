import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  createBlobStorage,
  createStoragePaths,
  type StoragePaths,
} from '@musetric/utils/node';

const blobTimestamp = new Date('2020-01-01T00:00:00.000Z');

export type StorageWorkspace = {
  paths: StoragePaths;
  addBlob: (content: Buffer) => Promise<string>;
  remove: () => void;
};

export const createStorageWorkspace = (): StorageWorkspace => {
  const rootPath = mkdtempSync(join(tmpdir(), 'musetric-api-'));
  const paths = createStoragePaths(rootPath);
  mkdirSync(paths.blobsPath, { recursive: true });
  mkdirSync(paths.publicPath, { recursive: true });
  mkdirSync(dirname(paths.databasePath), { recursive: true });
  writeFileSync(join(paths.publicPath, 'index.html'), '<!doctype html>\n');
  const blobStorage = createBlobStorage(paths.blobsPath);

  return {
    paths,
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
