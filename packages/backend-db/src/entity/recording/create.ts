import type { DatabaseSync } from 'node:sqlite';
import { transaction } from '../../common/index.js';

export type CreateRecordingArg = {
  projectId: number;
  audioAssetId: number;
  waveBlobId: string;
  sampleRate: number;
  frameCount: number;
};

export const create = (database: DatabaseSync) => {
  const insertWavePeaksStatement = database.prepare(
    `INSERT INTO AudioWavePeaks (audioAssetId, blobId) VALUES (?, ?)`,
  );
  const insertRecordingStatement = database.prepare(
    `INSERT INTO Recording (projectId, audioAssetId, sampleRate, frameCount)
     VALUES (?, ?, ?, ?)`,
  );

  return async (arg: CreateRecordingArg): Promise<void> => {
    await transaction(database, async () => {
      await Promise.resolve(
        insertWavePeaksStatement.run(arg.audioAssetId, arg.waveBlobId),
      );
      await Promise.resolve(
        insertRecordingStatement.run(
          arg.projectId,
          arg.audioAssetId,
          arg.sampleRate,
          arg.frameCount,
        ),
      );
    });
  };
};
