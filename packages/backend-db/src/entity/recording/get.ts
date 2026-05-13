import type { DatabaseSync } from 'node:sqlite';
import { table } from '../../schema/index.js';

export const get = (database: DatabaseSync) => {
  const statement = database.prepare(
    `SELECT Recording.id,
            Recording.projectId,
            Recording.audioAssetId,
            AudioWavePeaks.blobId AS waveBlobId,
            Recording.sampleRate,
            Recording.frameCount
     FROM Recording
     INNER JOIN AudioWavePeaks ON AudioWavePeaks.audioAssetId = Recording.audioAssetId
     WHERE Recording.projectId = ?`,
  );

  return async (
    projectId: number,
  ): Promise<table.recording.Item | undefined> => {
    const row = await Promise.resolve(statement.get(projectId));
    if (!row) {
      return undefined;
    }
    return table.recording.itemSchema.parse(row);
  };
};
