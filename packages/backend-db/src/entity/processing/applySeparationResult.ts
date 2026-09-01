import { type DatabaseSync } from 'node:sqlite';
import { transaction } from '../../common/index.js';
import { type table } from '../../schema/index.js';
import {
  runProjectAudioAnalysisUpsert,
  upsertProjectAudioAnalysisSql,
} from '../projectAudioAnalysis/statement.js';
import { clearError } from './clearError.js';

export type ApplySeparationResultArg = {
  projectId: number;
  audioAnalysis: Omit<table.projectAudioAnalysis.Item, 'projectId'>;
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
  const clearProcessingError = clearError(database);
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
  const upsertProjectAudioAnalysisStatement = database.prepare(
    upsertProjectAudioAnalysisSql,
  );

  return async (arg: ApplySeparationResultArg): Promise<void> =>
    await transaction(database, async () => {
      await Promise.resolve(
        runProjectAudioAnalysisUpsert(upsertProjectAudioAnalysisStatement, {
          projectId: arg.projectId,
          ...arg.audioAnalysis,
        }),
      );

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

      await clearProcessingError({
        projectId: arg.projectId,
        step: 'separation',
      });
    });
};
