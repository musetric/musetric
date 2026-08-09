import { type DatabaseSync } from 'node:sqlite';
import { rollbackQuietly } from './rollback.js';

export const transaction = async <T>(
  database: DatabaseSync,
  operation: () => Promise<T> | T,
): Promise<T> => {
  if (database.isTransaction) {
    return await operation();
  }
  await Promise.resolve(database.exec('BEGIN IMMEDIATE'));
  try {
    const result = await operation();
    await Promise.resolve(database.exec('COMMIT'));
    return result;
  } catch (error) {
    rollbackQuietly(database);
    throw error;
  }
};
