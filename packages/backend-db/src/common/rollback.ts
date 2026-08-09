import { type DatabaseSync } from 'node:sqlite';

export const rollbackQuietly = (database: DatabaseSync): void => {
  if (!database.isTransaction) {
    return;
  }
  try {
    database.exec('ROLLBACK');
  } catch {
    return;
  }
};
