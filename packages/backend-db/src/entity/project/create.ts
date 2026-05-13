import type { DatabaseSync } from 'node:sqlite';
import type { BlobFile } from '@musetric/resource-utils/node';
import { z } from 'zod';
import { transaction } from '../../common/index.js';
import { numericIdSchema, table } from '../../schema/index.js';

const createItemSchema = z.object({
  project: table.project.itemSchema,
  preview: table.preview.itemSchema.optional(),
});
export type CreateItem = z.infer<typeof createItemSchema>;

export type CreateArg = {
  name: string;
  song: BlobFile;
  preview?: BlobFile;
};

export const create = (database: DatabaseSync) => {
  const insertProjectStatement = database.prepare(
    `INSERT INTO Project (name) VALUES (?)`,
  );
  const insertAudioAssetStatement = database.prepare(
    `INSERT INTO AudioAsset (projectId, blobId) VALUES (?, ?)`,
  );
  const insertAudioMasterStatement = database.prepare(
    `INSERT INTO AudioMaster (projectId, type, audioAssetId) VALUES (?, ?, ?)`,
  );
  const insertPreviewStatement = database.prepare(
    `INSERT INTO Preview (projectId, blobId, filename, contentType) VALUES (?, ?, ?, ?)`,
  );

  return async (arg: CreateArg): Promise<CreateItem> => {
    return await transaction(database, async () => {
      const projectResult = await Promise.resolve(
        insertProjectStatement.run(arg.name),
      );
      const projectId = numericIdSchema.parse(projectResult.lastInsertRowid);
      const project = table.project.itemSchema.parse({
        id: projectId,
        name: arg.name,
      });

      const audioAssetResult = await Promise.resolve(
        insertAudioAssetStatement.run(projectId, arg.song.blobId),
      );
      const audioAssetId = numericIdSchema.parse(
        audioAssetResult.lastInsertRowid,
      );

      await Promise.resolve(
        insertAudioMasterStatement.run(projectId, 'rawSource', audioAssetId),
      );

      if (!arg.preview) {
        return createItemSchema.parse({ project, preview: undefined });
      }

      const previewResult = await Promise.resolve(
        insertPreviewStatement.run(
          projectId,
          arg.preview.blobId,
          arg.preview.filename,
          arg.preview.contentType,
        ),
      );
      const previewId = numericIdSchema.parse(previewResult.lastInsertRowid);
      const preview = table.preview.itemSchema.parse({
        id: previewId,
        projectId,
        blobId: arg.preview.blobId,
        filename: arg.preview.filename,
        contentType: arg.preview.contentType,
      });

      return createItemSchema.parse({ project, preview });
    });
  };
};
