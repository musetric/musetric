import { type DatabaseSync } from 'node:sqlite';
import { table } from '../../schema/index.js';

export const get = (database: DatabaseSync) => {
  const statement = database.prepare(
    `SELECT id, projectId, type, blobId
     FROM AudioMaster
     WHERE projectId = ? AND type = ?`,
  );

  return async (
    projectId: number,
    type: table.audioMaster.Type,
  ): Promise<table.audioMaster.Item | undefined> => {
    const row = await Promise.resolve(statement.get(projectId, type));
    if (!row) {
      return undefined;
    }
    return table.audioMaster.itemSchema.parse(row);
  };
};
