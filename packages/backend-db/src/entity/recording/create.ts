import { type DatabaseSync } from 'node:sqlite';
import { transaction } from '../../common/index.js';

export type CreateRecordingArg = {
  projectId: number;
  blobId: string;
  waveBlobId: string;
  sampleRate: number;
  frameCount: number;
};

export const create = (database: DatabaseSync) => {
  const insertRecordingStatement = database.prepare(
    `INSERT INTO Recording (projectId, blobId, waveBlobId, sampleRate, frameCount)
     VALUES (?, ?, ?, ?, ?)`,
  );

  return async (arg: CreateRecordingArg): Promise<void> => {
    await transaction(database, async () => {
      await Promise.resolve(
        insertRecordingStatement.run(
          arg.projectId,
          arg.blobId,
          arg.waveBlobId,
          arg.sampleRate,
          arg.frameCount,
        ),
      );
    });
  };
};
