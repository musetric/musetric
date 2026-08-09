import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { readDatabase, readSchemaVersion } from '../../common/index.js';
import {
  type MigrationFailure,
  readMigrationFailure,
} from '../../migrations/errors.js';
import { migrations } from '../../migrations/steps/index.js';
import { type Migration } from '../../migrations/types.js';

export type Workspace = {
  databasePath: string;
  remove: () => void;
};

export const createWorkspace = (): Workspace => {
  const directory = mkdtempSync(join(tmpdir(), 'musetric-db-'));
  return {
    databasePath: join(directory, 'db', 'app.db'),
    remove: () => {
      rmSync(directory, { recursive: true, force: true });
    },
  };
};

export const writeGarbageFile = (databasePath: string): void => {
  mkdirSync(dirname(databasePath), { recursive: true });
  writeFileSync(databasePath, 'this is not a database');
};

export const readUserVersion = (databasePath: string): number =>
  readDatabase(databasePath, readSchemaVersion);

export const readJournalMode = (databasePath: string): string =>
  readDatabase(databasePath, (database) => {
    const row = database.prepare('PRAGMA journal_mode').get();
    return String(row?.journal_mode);
  });

export const getFailure = (run: () => void): MigrationFailure => {
  try {
    run();
  } catch (error) {
    const migration = readMigrationFailure(error);
    if (migration) {
      return migration;
    }
    throw error;
  }
  throw new Error('the call was expected to fail');
};

export const withSteps = (
  steps: readonly Migration[],
): readonly Migration[] => [...migrations, ...steps];
