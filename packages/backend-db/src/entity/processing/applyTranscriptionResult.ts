import { type DatabaseSync } from 'node:sqlite';
import { transaction } from '../../common/index.js';

export type ApplyTranscriptionResultArg = {
  projectId: number;
  blobId: string;
};

export const applyTranscriptionResult = (database: DatabaseSync) => {
  const insertSubtitleStatement = database.prepare(
    `INSERT INTO Subtitle (projectId, blobId)
     VALUES (?, ?)
     ON CONFLICT(projectId) DO UPDATE SET blobId = excluded.blobId`,
  );

  return async (arg: ApplyTranscriptionResultArg): Promise<void> => {
    return await transaction(database, async () => {
      await Promise.resolve(
        insertSubtitleStatement.run(arg.projectId, arg.blobId),
      );
    });
  };
};
