import { type DatabaseSync } from 'node:sqlite';
import { table } from '../../schema/index.js';

export const get = (database: DatabaseSync) => {
  const statement = database.prepare(
    `SELECT id, projectId, stemType, blobId, waveBlobId
     FROM AudioDelivery
     WHERE projectId = ? AND stemType = ?`,
  );

  return async (
    projectId: number,
    stemType: table.audioDelivery.StemType,
  ): Promise<table.audioDelivery.Item | undefined> => {
    const row = await Promise.resolve(statement.get(projectId, stemType));
    if (!row) {
      return undefined;
    }
    return table.audioDelivery.itemSchema.parse(row);
  };
};
