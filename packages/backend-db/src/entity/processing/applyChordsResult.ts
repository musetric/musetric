import { type DatabaseSync } from 'node:sqlite';
import { transaction } from '../../common/index.js';

export type ApplyChordsResultArg = {
  projectId: number;
  blobId: string;
};

export const applyChordsResult = (database: DatabaseSync) => {
  const insertChordsStatement = database.prepare(
    `INSERT INTO Chords (projectId, blobId)
     VALUES (?, ?)
     ON CONFLICT(projectId) DO UPDATE SET blobId = excluded.blobId`,
  );

  return async (arg: ApplyChordsResultArg): Promise<void> =>
    await transaction(database, async () => {
      await Promise.resolve(
        insertChordsStatement.run(arg.projectId, arg.blobId),
      );
    });
};
