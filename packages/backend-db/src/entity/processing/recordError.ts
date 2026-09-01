import { type DatabaseSync } from 'node:sqlite';
import { type table } from '../../schema/index.js';

export const recordError = (database: DatabaseSync) => {
  const statement = database.prepare(
    `INSERT INTO ProcessingError (projectId, step, message)
     VALUES (?, ?, ?)
     ON CONFLICT(projectId, step) DO UPDATE SET message = excluded.message`,
  );

  return async (arg: table.processingError.Item): Promise<void> => {
    await Promise.resolve(statement.run(arg.projectId, arg.step, arg.message));
  };
};
