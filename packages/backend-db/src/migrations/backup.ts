import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type DatabaseSync } from 'node:sqlite';
import { readDatabase, readSchemaVersion } from '../common/index.js';

export const createBackupName = (version: number, date: Date): string => {
  const stamp = date.toISOString().replaceAll(/[:.]/gu, '-');
  return `app-${stamp}-v${String(version)}.db`;
};

const assertBackupVersion = (path: string, expectedVersion: number): void => {
  const version = readDatabase(path, readSchemaVersion);
  if (version === expectedVersion) {
    return;
  }
  throw new Error(
    `backup has schema v${String(version)} instead of v${String(expectedVersion)}`,
  );
};

export const createBackup = (
  database: DatabaseSync,
  databasePath: string,
  version: number,
): string => {
  const directory = join(dirname(databasePath), 'backups');
  mkdirSync(directory, { recursive: true });
  const path = join(directory, createBackupName(version, new Date()));
  try {
    database.prepare('VACUUM INTO ?').run(path);
    assertBackupVersion(path, version);
  } catch (error) {
    rmSync(path, { force: true });
    throw error;
  }
  return path;
};
