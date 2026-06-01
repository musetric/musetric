import { type DatabaseSync } from 'node:sqlite';
import { type BlobFile } from '@musetric/resource-utils/node';
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
  sampleRate: number;
  frameCount: number;
  preview?: BlobFile;
};

export const create = (database: DatabaseSync) => {
  const insertProjectStatement = database.prepare(
    `INSERT INTO Project (name, sampleRate, frameCount) VALUES (?, ?, ?)`,
  );
  const insertAudioMasterStatement = database.prepare(
    `INSERT INTO AudioMaster (projectId, type, blobId) VALUES (?, ?, ?)`,
  );
  const insertPreviewStatement = database.prepare(
    `INSERT INTO Preview (projectId, blobId, filename, contentType) VALUES (?, ?, ?, ?)`,
  );

  return async (arg: CreateArg): Promise<CreateItem> => {
    return await transaction(database, async () => {
      const projectResult = await Promise.resolve(
        insertProjectStatement.run(arg.name, arg.sampleRate, arg.frameCount),
      );
      const projectId = numericIdSchema.parse(projectResult.lastInsertRowid);
      const project = table.project.itemSchema.parse({
        id: projectId,
        name: arg.name,
        sampleRate: arg.sampleRate,
        frameCount: arg.frameCount,
      });

      await Promise.resolve(
        insertAudioMasterStatement.run(projectId, 'source', arg.song.blobId),
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
