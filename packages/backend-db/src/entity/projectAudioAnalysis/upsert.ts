import { type DatabaseSync } from 'node:sqlite';
import { transaction } from '../../common/index.js';
import { type table } from '../../schema/index.js';
import {
  runProjectAudioAnalysisUpsert,
  upsertProjectAudioAnalysisSql,
} from './statement.js';

export const upsert = (database: DatabaseSync) => {
  const statement = database.prepare(upsertProjectAudioAnalysisSql);

  return async (arg: table.projectAudioAnalysis.Item): Promise<void> => {
    await transaction(database, async () => {
      await Promise.resolve(runProjectAudioAnalysisUpsert(statement, arg));
    });
  };
};
