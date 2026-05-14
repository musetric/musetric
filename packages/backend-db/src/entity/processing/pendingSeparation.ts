import type { DatabaseSync } from 'node:sqlite';
import { table } from '../../schema/index.js';

export const pendingSeparation = (database: DatabaseSync) => {
  const statement = database.prepare(
    `SELECT Source.id, Source.projectId, Source.type, Source.blobId
     FROM AudioMaster AS Source
     WHERE Source.type = 'source'
       AND NOT EXISTS (
        SELECT 1 FROM AudioMaster AS Lead
        WHERE Lead.projectId = Source.projectId AND Lead.type = 'lead'
       )
     `,
  );

  return async (): Promise<table.audioMaster.Item | undefined> => {
    const row = await Promise.resolve(statement.get());
    if (!row) {
      return undefined;
    }
    return table.audioMaster.itemSchema.parse(row);
  };
};
