import { type DatabaseSync } from 'node:sqlite';
import { table } from '../../schema/index.js';

export const getErrorsByProject = (database: DatabaseSync) => {
  const statement = database.prepare(
    `SELECT projectId, step, message
     FROM ProcessingError
     WHERE projectId = ?`,
  );

  return async (projectId: number): Promise<table.processingError.Item[]> => {
    const rows = await Promise.resolve(statement.all(projectId));
    const errors: table.processingError.Item[] = [];
    for (const row of rows) {
      errors.push(table.processingError.itemSchema.parse(row));
    }
    return errors;
  };
};
