import type { DatabaseSync } from 'node:sqlite';
import { table } from '../../schema/index.js';

export const get = (database: DatabaseSync) => {
  const statement = database.prepare(
    `SELECT AudioDelivery.id, AudioDelivery.projectId, AudioDelivery.stemType, AudioDelivery.audioAssetId, AudioAsset.blobId
     FROM AudioDelivery
     INNER JOIN AudioAsset ON AudioAsset.id = AudioDelivery.audioAssetId
     WHERE AudioDelivery.projectId = ? AND AudioDelivery.stemType = ?`,
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
