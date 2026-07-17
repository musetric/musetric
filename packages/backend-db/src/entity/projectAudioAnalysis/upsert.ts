import { type DatabaseSync } from 'node:sqlite';
import { transaction } from '../../common/index.js';
import { type table } from '../../schema/index.js';

export const upsert = (database: DatabaseSync) => {
  const statement = database.prepare(
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

  return async (arg: table.projectAudioAnalysis.Item): Promise<void> => {
    await transaction(database, async () => {
      await Promise.resolve(
        statement.run(
          arg.projectId,
          arg.sourceIntegratedLoudnessDb,
          arg.sourceTruePeakDb,
          arg.sourceGainDb,
          arg.leadIntegratedLoudnessDb,
          arg.leadTruePeakDb,
          arg.leadP95RmsDb,
          arg.leadSpectrogramGainDb,
        ),
      );
    });
  };
};
