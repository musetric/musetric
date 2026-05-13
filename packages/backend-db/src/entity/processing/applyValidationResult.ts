import type { DatabaseSync } from 'node:sqlite';
import { transaction } from '../../common/index.js';
import { numericIdSchema } from '../../schema/index.js';

export type ApplyValidationResultArg = {
  projectId: number;
  sourceId: string;
  rawSourceId: string;
};

export const applyValidationResult = (database: DatabaseSync) => {
  const getSourceAudioAssetStatement = database.prepare(
    `SELECT audioAssetId FROM AudioMaster WHERE projectId = ? AND type = 'source'`,
  );
  const insertAudioAssetStatement = database.prepare(
    `INSERT INTO AudioAsset (projectId, blobId) VALUES (?, ?)`,
  );
  const upsertAudioMasterStatement = database.prepare(
    `INSERT INTO AudioMaster (projectId, type, audioAssetId) VALUES (?, 'source', ?)
     ON CONFLICT(projectId, type) DO UPDATE SET audioAssetId = excluded.audioAssetId`,
  );
  const deleteAudioMasterStatement = database.prepare(
    `DELETE FROM AudioMaster WHERE projectId = ? AND type = 'rawSource'`,
  );
  const deleteAudioAssetByBlobStatement = database.prepare(
    `DELETE FROM AudioAsset WHERE projectId = ? AND blobId = ?`,
  );
  const deleteAudioAssetByIdStatement = database.prepare(
    `DELETE FROM AudioAsset WHERE id = ?`,
  );

  return async (arg: ApplyValidationResultArg): Promise<void> => {
    return await transaction(database, async () => {
      const previousSource = await Promise.resolve(
        getSourceAudioAssetStatement.get(arg.projectId),
      );
      const previousSourceAudioAssetId =
        previousSource &&
        typeof previousSource === 'object' &&
        'audioAssetId' in previousSource
          ? numericIdSchema.parse(previousSource.audioAssetId)
          : undefined;

      const audioAssetResult = await Promise.resolve(
        insertAudioAssetStatement.run(arg.projectId, arg.sourceId),
      );
      const audioAssetId = numericIdSchema.parse(
        audioAssetResult.lastInsertRowid,
      );

      await Promise.resolve(
        upsertAudioMasterStatement.run(arg.projectId, audioAssetId),
      );
      await Promise.resolve(deleteAudioMasterStatement.run(arg.projectId));
      await Promise.resolve(
        deleteAudioAssetByBlobStatement.run(arg.projectId, arg.rawSourceId),
      );
      if (
        previousSourceAudioAssetId !== undefined &&
        previousSourceAudioAssetId !== audioAssetId
      ) {
        await Promise.resolve(
          deleteAudioAssetByIdStatement.run(previousSourceAudioAssetId),
        );
      }
    });
  };
};
