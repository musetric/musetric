import type { DatabaseSync } from 'node:sqlite';
import { table } from '../../schema/index.js';

export const pendingTranscription = (database: DatabaseSync) => {
  const statement = database.prepare(
    `SELECT Lead.id, Lead.projectId, Lead.type, Lead.blobId
     FROM AudioMaster AS Lead
     LEFT JOIN Subtitle
       ON Subtitle.projectId = Lead.projectId
     WHERE Lead.type = 'lead' AND Subtitle.id IS NULL
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
