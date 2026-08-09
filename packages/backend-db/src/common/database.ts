import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const databaseTimeoutMs = 5000;

export const closeDatabase = (database: DatabaseSync): void => {
  if (database.isOpen) {
    database.close();
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
