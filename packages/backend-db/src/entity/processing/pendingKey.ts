import type { DatabaseSync } from 'node:sqlite';
import { table } from '../../schema/index.js';

export const pendingKey = (database: DatabaseSync) => {
  const statement = database.prepare(
    `SELECT Instrumental.id, Instrumental.projectId, Instrumental.type, Instrumental.blobId
     FROM AudioMaster AS Instrumental
     LEFT JOIN Key
       ON Key.projectId = Instrumental.projectId
     WHERE Instrumental.type = 'instrumental' AND Key.id IS NULL
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
