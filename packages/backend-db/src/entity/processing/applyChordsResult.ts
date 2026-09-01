import { type DatabaseSync } from 'node:sqlite';
import { transaction } from '../../common/index.js';
import { clearError } from './clearError.js';

export type ApplyChordsResultArg = {
  projectId: number;
  blobId: string;
};

export const applyChordsResult = (database: DatabaseSync) => {
  const clearProcessingError = clearError(database);
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
      await clearProcessingError({ projectId: arg.projectId, step: 'chords' });
    });
};
