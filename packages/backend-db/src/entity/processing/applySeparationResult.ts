import { type DatabaseSync } from 'node:sqlite';
import { transaction } from '../../common/index.js';

export type ApplySeparationResultArg = {
  projectId: number;
  audioAnalysis: {
    sourceIntegratedLoudnessDb: number;
    sourceTruePeakDb: number;
    sourceGainDb: number;
    leadIntegratedLoudnessDb: number;
    leadTruePeakDb: number;
    leadP95RmsDb: number;
    leadSpectrogramGainDb: number;
  };
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
  const upsertProjectAudioAnalysisStatement = database.prepare(
    `INSERT INTO ProjectAudioAnalysis (
       projectId,
       sourceIntegratedLoudnessDb,
       sourceTruePeakDb,
       sourceGainDb,
       leadIntegratedLoudnessDb,
       leadTruePeakDb,
       leadP95RmsDb,
       leadSpectrogramGainDb
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(projectId) DO UPDATE SET
       sourceIntegratedLoudnessDb = excluded.sourceIntegratedLoudnessDb,
       sourceTruePeakDb = excluded.sourceTruePeakDb,
       sourceGainDb = excluded.sourceGainDb,
       leadIntegratedLoudnessDb = excluded.leadIntegratedLoudnessDb,
       leadTruePeakDb = excluded.leadTruePeakDb,
       leadP95RmsDb = excluded.leadP95RmsDb,
       leadSpectrogramGainDb = excluded.leadSpectrogramGainDb`,
  );

  return async (arg: ApplySeparationResultArg): Promise<void> => {
    return await transaction(database, async () => {
      await Promise.resolve(
        upsertProjectAudioAnalysisStatement.run(
          arg.projectId,
          arg.audioAnalysis.sourceIntegratedLoudnessDb,
          arg.audioAnalysis.sourceTruePeakDb,
          arg.audioAnalysis.sourceGainDb,
          arg.audioAnalysis.leadIntegratedLoudnessDb,
          arg.audioAnalysis.leadTruePeakDb,
          arg.audioAnalysis.leadP95RmsDb,
          arg.audioAnalysis.leadSpectrogramGainDb,
        ),
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
    });
  };
};
