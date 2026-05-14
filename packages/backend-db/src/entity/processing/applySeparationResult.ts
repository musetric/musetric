import type { DatabaseSync } from 'node:sqlite';
import { transaction } from '../../common/index.js';

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
  const upsertAudioMasterStatement = database.prepare(
    `INSERT INTO AudioMaster (projectId, type, blobId) VALUES (?, ?, ?)
     ON CONFLICT(projectId, type) DO UPDATE SET blobId = excluded.blobId`,
  );
  const upsertAudioDeliveryStatement = database.prepare(
    `INSERT INTO AudioDelivery (projectId, stemType, blobId, waveBlobId)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(projectId, stemType) DO UPDATE SET
       blobId = excluded.blobId,
       waveBlobId = excluded.waveBlobId`,
  );

  return async (arg: ApplySeparationResultArg): Promise<void> => {
    return await transaction(database, async () => {
      await Promise.resolve(
        upsertAudioMasterStatement.run(
          arg.projectId,
          'lead',
          arg.master.leadId,
        ),
      );

      await Promise.resolve(
        upsertAudioMasterStatement.run(
          arg.projectId,
          'instrumental',
          arg.master.instrumentalId,
        ),
      );

      await Promise.resolve(
        upsertAudioMasterStatement.run(
          arg.projectId,
          'backing',
          arg.master.backingId,
        ),
      );

      await Promise.resolve(
        upsertAudioDeliveryStatement.run(
          arg.projectId,
          'lead',
          arg.delivery.leadId,
          arg.wavePeaks.leadId,
        ),
      );

      await Promise.resolve(
        upsertAudioDeliveryStatement.run(
          arg.projectId,
          'instrumental',
          arg.delivery.instrumentalId,
          arg.wavePeaks.instrumentalId,
        ),
      );

      await Promise.resolve(
        upsertAudioDeliveryStatement.run(
          arg.projectId,
          'backing',
          arg.delivery.backingId,
          arg.wavePeaks.backingId,
        ),
      );
    });
  };
};
