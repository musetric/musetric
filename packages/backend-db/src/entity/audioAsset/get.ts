import type { DatabaseSync } from 'node:sqlite';
import { table } from '../../schema/index.js';

export const get = (database: DatabaseSync) => {
  const statement = database.prepare(
    `SELECT id, projectId, blobId
     FROM AudioAsset
     WHERE id = ?`,
  );

  return async (
    audioAssetId: number,
  ): Promise<table.audioAsset.Item | undefined> => {
    const row = await Promise.resolve(statement.get(audioAssetId));
    if (!row) {
      return undefined;
    }
    return table.audioAsset.itemSchema.parse(row);
  };
};
