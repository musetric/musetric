import { type DatabaseSync } from 'node:sqlite';
import { type z } from 'zod';
import { bucketizeRow, hasValue } from '../../common/index.js';
import { table } from '../../schema/index.js';

const listItemSchema = table.project.itemSchema.extend({
  preview: table.preview.itemSchema.optional(),
});
export type ListItem = z.infer<typeof listItemSchema>;

export const list = (database: DatabaseSync) => {
  const statement = database.prepare(`
    SELECT
      Project.id AS project_id,
      Project.name AS project_name,
      Project.sampleRate AS project_sampleRate,
      Project.frameCount AS project_frameCount,
      Preview.id AS preview_id,
      Preview.projectId AS preview_projectId,
      Preview.blobId AS preview_blobId,
      Preview.filename AS preview_filename,
      Preview.contentType AS preview_contentType
    FROM Project
    LEFT JOIN Preview ON Preview.projectId = Project.id
    ORDER BY Project.id DESC
  `);

  return async (): Promise<ListItem[]> => {
    const rows = await Promise.resolve(statement.all());
    return rows.map((row) => {
      const buckets = bucketizeRow(row);
      return listItemSchema.parse({
        ...buckets.project,
        preview: hasValue(buckets.preview?.id) ? buckets.preview : undefined,
      });
    });
  };
};
