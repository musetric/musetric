import type { DatabaseSync } from 'node:sqlite';
import { table } from '../../schema/index.js';

export const get = (database: DatabaseSync) => {
  const statement = database.prepare(
    `SELECT AudioWavePeaks.id, AudioDelivery.projectId, AudioDelivery.stemType, AudioDelivery.audioAssetId, AudioWavePeaks.blobId
     FROM AudioDelivery
     INNER JOIN AudioWavePeaks ON AudioWavePeaks.audioAssetId = AudioDelivery.audioAssetId
     WHERE AudioDelivery.projectId = ? AND AudioDelivery.stemType = ?`,
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
