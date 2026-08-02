import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const sqliteBusyErrorCode = 5;

const isBusyError = (error: unknown): boolean =>
  error instanceof Error &&
  'errcode' in error &&
  error.errcode === sqliteBusyErrorCode;

export type StorageLock = {
  release: () => void;
};

export const acquireStorageLock = (
  lockPath: string,
): StorageLock | undefined => {
  mkdirSync(dirname(lockPath), { recursive: true });
  const database = new DatabaseSync(lockPath, { timeout: 0 });
  try {
    database.exec('BEGIN EXCLUSIVE');
  } catch (error) {
    database.close();
    if (isBusyError(error)) {
      return undefined;
    }
    throw error;
  }
  return {
    release: () => {
      database.close();
    },
  };
};
