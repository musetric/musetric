import { type DatabaseSync } from 'node:sqlite';
import { table } from '../../schema/index.js';

export const get = (database: DatabaseSync) => {
  const statement = database.prepare(
    `SELECT projectId,
            sourceIntegratedLoudnessDb,
            sourceTruePeakDb,
            sourceGainDb,
            leadIntegratedLoudnessDb,
            leadTruePeakDb,
            leadP95RmsDb,
            leadSpectrogramGainDb
     FROM ProjectAudioAnalysis
     WHERE projectId = ?`,
  );

  return async (
    projectId: number,
  ): Promise<table.projectAudioAnalysis.Item | undefined> => {
    const row = await Promise.resolve(statement.get(projectId));
    if (!row) {
      return undefined;
    }
    return table.projectAudioAnalysis.itemSchema.parse(row);
  };
};
