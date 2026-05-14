import type { DatabaseSync } from 'node:sqlite';
import { numericIdSchema, table } from '../../schema/index.js';

export type CreateAudioAssetArg = {
  projectId: number;
  blobId: string;
};

export const create = (database: DatabaseSync) => {
  const statement = database.prepare(
    `INSERT INTO AudioAsset (projectId, blobId) VALUES (?, ?)`,
  );

  return async (arg: CreateAudioAssetArg): Promise<table.audioAsset.Item> => {
    const result = await Promise.resolve(
      statement.run(arg.projectId, arg.blobId),
    );
    return table.audioAsset.itemSchema.parse({
      id: numericIdSchema.parse(result.lastInsertRowid),
      projectId: arg.projectId,
      blobId: arg.blobId,
    });
  };
};
