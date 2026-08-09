import { existsSync } from 'node:fs';
import { type DatabaseSync } from 'node:sqlite';
import {
  openDatabase,
  readDatabase,
  readSchemaVersion,
  rollbackQuietly,
  withDatabase,
  writeSchemaVersion,
} from '../common/index.js';
import { createBackup } from './backup.js';
import { createMigrationFailure } from './errors.js';
import { type Migration, type MigrationReport } from './types.js';

const probeVersion = (databasePath: string): number => {
  if (!existsSync(databasePath)) {
    return 0;
  }
  try {
    return readDatabase(databasePath, readSchemaVersion);
  } catch (cause) {
    throw createMigrationFailure({
      message: 'The database file could not be read and may be damaged.',
      cause,
    });
  }
};

const takeBackup = (
  database: DatabaseSync,
  databasePath: string,
  version: number,
): string => {
  try {
    return createBackup(database, databasePath, version);
  } catch (cause) {
    throw createMigrationFailure({
      message:
        'The database backup could not be created, so nothing was changed.',
      cause,
    });
  }
};

const applyMigration = (
  database: DatabaseSync,
  statements: Migration,
  version: number,
  backupPath: string | undefined,
): void => {
  try {
    database.exec('BEGIN IMMEDIATE');
    for (const statement of statements) {
      database.exec(statement);
    }
    const violations = database.prepare('PRAGMA foreign_key_check').all();
    if (violations.length > 0) {
      throw new Error(`foreign key violations: ${JSON.stringify(violations)}`);
    }
    writeSchemaVersion(database, version);
    database.exec('COMMIT');
  } catch (cause) {
    rollbackQuietly(database);
    throw createMigrationFailure({
      committedVersion: version - 1,
      backupPath,
      message: `Migration v${String(version)} did not finish. It was rolled back, so the database still holds schema v${String(version - 1)}.`,
      cause,
    });
  }
};

export const runMigrations = (
  databasePath: string,
  steps: readonly Migration[],
): MigrationReport => {
  const latest = steps.length;
  const fromVersion = probeVersion(databasePath);
  if (fromVersion > latest) {
    throw createMigrationFailure({
      message: `The database holds schema v${String(fromVersion)}, which this build does not know: it supports v${String(latest)}. Install the newer version again, or restore an older copy of the database.`,
    });
  }
  if (fromVersion === latest) {
    return { fromVersion, toVersion: latest };
  }
  return withDatabase(
    openDatabase(databasePath, { foreignKeys: false }),
    (database) => {
      const backupPath =
        fromVersion > 0
          ? takeBackup(database, databasePath, fromVersion)
          : undefined;
      for (let version = fromVersion + 1; version <= latest; version += 1) {
        applyMigration(database, steps[version - 1], version, backupPath);
      }
      return { fromVersion, toVersion: latest, backupPath };
    },
  );
};
