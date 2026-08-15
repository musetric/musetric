import { type StatementSync } from 'node:sqlite';
import { type table } from '../../schema/index.js';

export const upsertProjectAudioAnalysisSql = `
  INSERT INTO ProjectAudioAnalysis (
    projectId,
    sourceIntegratedLoudnessDb,
    sourceTruePeakDb,
    sourceGainDb,
    leadIntegratedLoudnessDb,
    leadTruePeakDb,
    leadP95RmsDb,
    leadSpectrogramGainDb,
    backingIntegratedLoudnessDb,
    backingTruePeakDb,
    instrumentalIntegratedLoudnessDb,
    instrumentalTruePeakDb,
    leadGainDb,
    backingGainDb,
    instrumentalGainDb
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(projectId) DO UPDATE SET
    sourceIntegratedLoudnessDb = excluded.sourceIntegratedLoudnessDb,
    sourceTruePeakDb = excluded.sourceTruePeakDb,
    sourceGainDb = excluded.sourceGainDb,
    leadIntegratedLoudnessDb = excluded.leadIntegratedLoudnessDb,
    leadTruePeakDb = excluded.leadTruePeakDb,
    leadP95RmsDb = excluded.leadP95RmsDb,
    leadSpectrogramGainDb = excluded.leadSpectrogramGainDb,
    backingIntegratedLoudnessDb = excluded.backingIntegratedLoudnessDb,
    backingTruePeakDb = excluded.backingTruePeakDb,
    instrumentalIntegratedLoudnessDb = excluded.instrumentalIntegratedLoudnessDb,
    instrumentalTruePeakDb = excluded.instrumentalTruePeakDb,
    leadGainDb = excluded.leadGainDb,
    backingGainDb = excluded.backingGainDb,
    instrumentalGainDb = excluded.instrumentalGainDb
`;

export const runProjectAudioAnalysisUpsert = (
  statement: StatementSync,
  item: table.projectAudioAnalysis.Item,
): void => {
  statement.run(
    item.projectId,
    item.sourceIntegratedLoudnessDb,
    item.sourceTruePeakDb,
    item.sourceGainDb,
    item.leadIntegratedLoudnessDb,
    item.leadTruePeakDb,
    item.leadP95RmsDb,
    item.leadSpectrogramGainDb,
    item.backingIntegratedLoudnessDb,
    item.backingTruePeakDb,
    item.instrumentalIntegratedLoudnessDb,
    item.instrumentalTruePeakDb,
    item.leadGainDb,
    item.backingGainDb,
    item.instrumentalGainDb,
  );
};
