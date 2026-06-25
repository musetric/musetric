import { type DatabaseSync } from 'node:sqlite';
import { type BlobFile } from '@musetric/utils/node';
import { z } from 'zod';
import { transaction } from '../../common/index.js';
import { numericIdSchema, table } from '../../schema/index.js';
import { get } from './get.js';

const updateItemSchema = z.object({
  project: table.project.itemSchema,
  preview: table.preview.itemSchema.optional(),
});
export type UpdateItem = z.infer<typeof updateItemSchema>;

export type UpdateArg = {
  projectId: number;
  name?: string;
  preview?: BlobFile;
  withoutPreview?: boolean;
};

export const update = (database: DatabaseSync) => {
  const getProject = get(database);
  const updateProjectNameStatement = database.prepare(
    `UPDATE Project SET name = ? WHERE id = ?`,
  );
  const insertPreviewStatement = database.prepare(
    `INSERT INTO Preview (projectId, blobId, filename, contentType) VALUES (?, ?, ?, ?)`,
  );
  const deletePreviewStatement = database.prepare(
    `DELETE FROM Preview WHERE projectId = ?`,
  );

  return async (arg: UpdateArg): Promise<UpdateItem | undefined> => {
    return await transaction(database, async () => {
      const current = await getProject(arg.projectId);
      if (!current) {
        return undefined;
      }

      const baseProject = table.project.itemSchema.parse({
        id: current.id,
        name: current.name,
        sampleRate: current.sampleRate,
        frameCount: current.frameCount,
      });

      let updatedProject = baseProject;
      if (typeof arg.name === 'string') {
        await Promise.resolve(
          updateProjectNameStatement.run(arg.name, arg.projectId),
        );
        updatedProject = table.project.itemSchema.parse({
          id: baseProject.id,
          name: arg.name,
          sampleRate: baseProject.sampleRate,
          frameCount: baseProject.frameCount,
        });
      }

      const existingPreview = current.preview
        ? table.preview.itemSchema.parse(current.preview)
        : undefined;

      if (existingPreview && (arg.preview || arg.withoutPreview)) {
        await Promise.resolve(deletePreviewStatement.run(arg.projectId));
      }

      if (arg.withoutPreview) {
        return updateItemSchema.parse({
          project: updatedProject,
          preview: undefined,
        });
      }

      if (arg.preview) {
        const previewResult = await Promise.resolve(
          insertPreviewStatement.run(
            arg.projectId,
            arg.preview.blobId,
            arg.preview.filename,
            arg.preview.contentType,
          ),
        );
        const previewId = numericIdSchema.parse(previewResult.lastInsertRowid);
        const preview = table.preview.itemSchema.parse({
          id: previewId,
          projectId: arg.projectId,
          blobId: arg.preview.blobId,
          filename: arg.preview.filename,
          contentType: arg.preview.contentType,
        });
        return updateItemSchema.parse({ project: updatedProject, preview });
      }

      return updateItemSchema.parse({
        project: updatedProject,
        preview: existingPreview,
      });
    });
  };
};
