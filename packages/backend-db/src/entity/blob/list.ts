import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

const blobRowSchema = z.object({
  blobId: z.string(),
});

export const list = (database: DatabaseSync) => {
  const statement = database.prepare(
    `SELECT blobId FROM AudioAsset
     UNION ALL SELECT blobId FROM AudioWavePeaks
     UNION ALL SELECT blobId FROM Preview
     UNION ALL SELECT blobId FROM Subtitle`,
  );

  return async (): Promise<string[]> => {
    const blobIds: string[] = [];
    const rows = await Promise.resolve(statement.all());
    rows.forEach((row) => {
      const parsed = blobRowSchema.parse(row);
      blobIds.push(parsed.blobId);
    });
    return blobIds;
  };
};
