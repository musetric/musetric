import { type DatabaseSync } from 'node:sqlite';
import { transaction } from '../../common/index.js';

export type ApplyKeyResultArg = {
  projectId: number;
  blobId: string;
};

export const applyKeyResult = (database: DatabaseSync) => {
  const insertKeyStatement = database.prepare(
    `INSERT INTO Key (projectId, blobId)
     VALUES (?, ?)
     ON CONFLICT(projectId) DO UPDATE SET blobId = excluded.blobId`,
  );

  return async (arg: ApplyKeyResultArg): Promise<void> => {
    return await transaction(database, async () => {
      await Promise.resolve(insertKeyStatement.run(arg.projectId, arg.blobId));
    });
  };
};
