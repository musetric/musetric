import { closeDatabase, openDatabase } from '../common/index.js';
import { migrations } from './steps/index.js';

export const initDatabase = async (databasePath: string): Promise<void> => {
  const database = openDatabase(databasePath, { foreignKeys: true });
  try {
    for (const statements of migrations) {
      for (const statement of statements) {
        await Promise.resolve(database.exec(statement));
      }
    }
  } finally {
    closeDatabase(database);
  }
};
