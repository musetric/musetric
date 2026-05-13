import type { DatabaseSync } from 'node:sqlite';
import { transaction } from '../../common/index.js';
import { numericIdSchema } from '../../schema/index.js';

export type ApplySeparationResultArg = {
  projectId: number;
  master: {
    leadId: string;
    backingId: string;
    instrumentalId: string;
  };
  delivery: {
    leadId: string;
    backingId: string;
    instrumentalId: string;
  };
  wavePeaks: {
    leadId: string;
    backingId: string;
    instrumentalId: string;
  };
};

export const applySeparationResult = (database: DatabaseSync) => {
  const getAudioMasterAssetStatement = database.prepare(
    `SELECT audioAssetId FROM AudioMaster WHERE projectId = ? AND type = ?`,
  );
  const getAudioDeliveryAssetStatement = database.prepare(
    `SELECT audioAssetId FROM AudioDelivery WHERE projectId = ? AND stemType = ?`,
  );
  const insertAudioAssetStatement = database.prepare(
    `INSERT INTO AudioAsset (projectId, blobId) VALUES (?, ?)`,
  );
  const upsertAudioMasterStatement = database.prepare(
    `INSERT INTO AudioMaster (projectId, type, audioAssetId) VALUES (?, ?, ?)
     ON CONFLICT(projectId, type) DO UPDATE SET audioAssetId = excluded.audioAssetId`,
  );
  const upsertAudioDeliveryStatement = database.prepare(
    `INSERT INTO AudioDelivery (projectId, stemType, audioAssetId) VALUES (?, ?, ?)
     ON CONFLICT(projectId, stemType) DO UPDATE SET audioAssetId = excluded.audioAssetId`,
  );
  const upsertWavePeaksStatement = database.prepare(
    `INSERT INTO AudioWavePeaks (audioAssetId, blobId) VALUES (?, ?)
     ON CONFLICT(audioAssetId) DO UPDATE SET blobId = excluded.blobId`,
  );
  const deleteAudioAssetStatement = database.prepare(
    `DELETE FROM AudioAsset WHERE id = ?`,
  );

  return async (arg: ApplySeparationResultArg): Promise<void> => {
    return await transaction(database, async () => {
      const previousRows = await Promise.all([
        Promise.resolve(
          getAudioMasterAssetStatement.get(arg.projectId, 'lead'),
        ),
        Promise.resolve(
          getAudioMasterAssetStatement.get(arg.projectId, 'instrumental'),
        ),
        Promise.resolve(
          getAudioMasterAssetStatement.get(arg.projectId, 'backing'),
        ),
        Promise.resolve(
          getAudioDeliveryAssetStatement.get(arg.projectId, 'lead'),
        ),
        Promise.resolve(
          getAudioDeliveryAssetStatement.get(arg.projectId, 'instrumental'),
        ),
        Promise.resolve(
          getAudioDeliveryAssetStatement.get(arg.projectId, 'backing'),
        ),
      ]);
      const previousAudioAssetIds = previousRows
        .map((row) =>
          row && typeof row === 'object' && 'audioAssetId' in row
            ? numericIdSchema.parse(row.audioAssetId)
            : undefined,
        )
        .filter((id): id is number => id !== undefined);

      const createAudioAsset = async (blobId: string) => {
        const result = await Promise.resolve(
          insertAudioAssetStatement.run(arg.projectId, blobId),
        );
        return numericIdSchema.parse(result.lastInsertRowid);
      };

      const masterLeadId = await createAudioAsset(arg.master.leadId);
      const masterInstrumentalId = await createAudioAsset(
        arg.master.instrumentalId,
      );
      const masterBackingId = await createAudioAsset(arg.master.backingId);
      const deliveryLeadId = await createAudioAsset(arg.delivery.leadId);
      const deliveryInstrumentalId = await createAudioAsset(
        arg.delivery.instrumentalId,
      );
      const deliveryBackingId = await createAudioAsset(arg.delivery.backingId);

      await Promise.resolve(
        upsertAudioMasterStatement.run(arg.projectId, 'lead', masterLeadId),
      );

      await Promise.resolve(
        upsertAudioMasterStatement.run(
          arg.projectId,
          'instrumental',
          masterInstrumentalId,
        ),
      );

      await Promise.resolve(
        upsertAudioMasterStatement.run(
          arg.projectId,
          'backing',
          masterBackingId,
        ),
      );

      await Promise.resolve(
        upsertAudioDeliveryStatement.run(arg.projectId, 'lead', deliveryLeadId),
      );

      await Promise.resolve(
        upsertAudioDeliveryStatement.run(
          arg.projectId,
          'instrumental',
          deliveryInstrumentalId,
        ),
      );

      await Promise.resolve(
        upsertAudioDeliveryStatement.run(
          arg.projectId,
          'backing',
          deliveryBackingId,
        ),
      );

      await Promise.resolve(
        upsertWavePeaksStatement.run(deliveryLeadId, arg.wavePeaks.leadId),
      );

      await Promise.resolve(
        upsertWavePeaksStatement.run(
          deliveryInstrumentalId,
          arg.wavePeaks.instrumentalId,
        ),
      );

      await Promise.resolve(
        upsertWavePeaksStatement.run(
          deliveryBackingId,
          arg.wavePeaks.backingId,
        ),
      );

      const nextAudioAssetIds = new Set([
        masterLeadId,
        masterInstrumentalId,
        masterBackingId,
        deliveryLeadId,
        deliveryInstrumentalId,
        deliveryBackingId,
      ]);
      for (const previousAudioAssetId of previousAudioAssetIds) {
        if (!nextAudioAssetIds.has(previousAudioAssetId)) {
          await Promise.resolve(
            deleteAudioAssetStatement.run(previousAudioAssetId),
          );
        }
      }
    });
  };
};
