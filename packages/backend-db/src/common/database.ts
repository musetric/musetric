import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const databaseTimeoutMs = 5000;

export const closeDatabase = (database: DatabaseSync): void => {
  if (database.isOpen) {
    database.close();
  }
};

export const withDatabase = <T>(
  database: DatabaseSync,
  run: (database: DatabaseSync) => T,
): T => {
  try {
    return run(database);
  } finally {
    closeDatabase(database);
  }
};

export type OpenDatabaseOptions = {
  foreignKeys: boolean;
};

export const openDatabase = (
  databasePath: string,
  options: OpenDatabaseOptions,
): DatabaseSync => {
  mkdirSync(dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath, {
    enableForeignKeyConstraints: options.foreignKeys,
    timeout: databaseTimeoutMs,
  });
  try {
    database.exec('PRAGMA journal_mode = WAL');
  } catch (error) {
    closeDatabase(database);
    throw error;
  }
  return database;
};

export const readDatabase = <T>(
  databasePath: string,
  read: (database: DatabaseSync) => T,
): T => withDatabase(new DatabaseSync(databasePath, { readOnly: true }), read);

export const readSchemaVersion = (database: DatabaseSync): number =>
  Number(database.prepare('PRAGMA user_version').get()?.user_version);

export const writeSchemaVersion = (
  database: DatabaseSync,
  version: number,
): void => {
  database.exec(`PRAGMA user_version = ${String(version)}`);
};
