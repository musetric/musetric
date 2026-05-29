import type { DatabaseSync } from 'node:sqlite';
import { table } from '../../schema/index.js';

export const getByProject = (database: DatabaseSync) => {
  const statement = database.prepare(
    `SELECT id, projectId, blobId FROM Chords WHERE projectId = ?`,
  );

  return async (projectId: number): Promise<table.chords.Item | undefined> => {
    const row = await Promise.resolve(statement.get(projectId));
    if (!row) {
      return undefined;
    }
    return table.chords.itemSchema.parse(row);
  };
};
