import { type DatabaseSync } from 'node:sqlite';
import { type table } from '../../schema/index.js';

export type ClearErrorArg = Pick<
  table.processingError.Item,
  'projectId' | 'step'
>;

export const clearError = (database: DatabaseSync) => {
  const statement = database.prepare(
    `DELETE FROM ProcessingError WHERE projectId = ? AND step = ?`,
  );

  return async (arg: ClearErrorArg): Promise<void> => {
    await Promise.resolve(statement.run(arg.projectId, arg.step));
  };
};
