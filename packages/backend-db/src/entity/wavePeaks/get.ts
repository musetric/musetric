import type { DatabaseSync } from 'node:sqlite';
import { table } from '../../schema/index.js';

export const get = (database: DatabaseSync) => {
  const statement = database.prepare(
    `SELECT id, projectId, stemType, waveBlobId AS blobId
     FROM AudioDelivery
     WHERE projectId = ? AND stemType = ?`,
  );

  return async (
    projectId: number,
    stemType: table.wavePeaks.StemType,
  ): Promise<table.wavePeaks.Item | undefined> => {
    const row = await Promise.resolve(statement.get(projectId, stemType));
    if (!row) {
      return undefined;
    }
    return table.wavePeaks.itemSchema.parse(row);
  };
};
