import type { DatabaseSync } from 'node:sqlite';
import { transaction } from '../../common/index.js';

export type ApplyRhythmResultArg = {
  projectId: number;
  blobId: string;
};

export const applyRhythmResult = (database: DatabaseSync) => {
  const insertRhythmStatement = database.prepare(
    `INSERT INTO Rhythm (projectId, blobId)
     VALUES (?, ?)
     ON CONFLICT(projectId) DO UPDATE SET blobId = excluded.blobId`,
  );

  return async (arg: ApplyRhythmResultArg): Promise<void> => {
    return await transaction(database, async () => {
      await Promise.resolve(
        insertRhythmStatement.run(arg.projectId, arg.blobId),
      );
    });
  };
};
